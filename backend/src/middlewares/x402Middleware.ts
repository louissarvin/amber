import type { FastifyReply, FastifyRequest } from 'fastify';
import { keccak_256 } from '@noble/hashes/sha3';
import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import { verifyEip3009 } from '../lib/xlayer/usdt.ts';
import {
  buildExactChallenge,
  encodeChallenge,
  type HttpMethod,
} from '../lib/x402/challenge.ts';
import { decodeReply, DecodeError } from '../lib/x402/decodeReply.ts';
import {
  ASP_WALLET_ADDRESS,
  PUBLIC_BASE_URL,
  XLAYER_CHAIN_ID,
} from '../config/main-config.ts';
import { AmberErrorCodes, handleError } from '../utils/errorHandler.ts';
import { getOrCreateIdentity } from '../services/identity.ts';
import { debitSubscription, verifyAppAccessToken } from '../services/subscription.ts';

// -----------------------------------------------------------------------------
// x402 "exact" scheme verifier — Fastify preHandler factory.
//
// This is the single wire-boundary for a paid endpoint. On success it attaches
// `request.amberPayment` and returns 'ok'. On any failure it writes the reply
// (via handleError) and returns 'reply-sent'. Handlers MUST check the return
// value and short-circuit when reply-sent.
//
// Nonce dedupe: Redis `SET NX EX 300` (fast) plus a durable UNIQUE on
// PaymentNonce.nonce. Redis unavailable -> fail closed with INTERNAL.
// -----------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    amberPayment?: {
      payer: string;
      nonce: string;
      amountAtomic: bigint;
      endpoint: string;
    };
  }
}

const CLOCK_SKEW_SECONDS = 60;
const NONCE_TTL_SECONDS = 86400; // 24h

export type X402Result = 'ok' | 'reply-sent';

export interface X402ExactOpts {
  priceAtomic: number;
  endpoint: string;
  identityInBody: string;
  method?: HttpMethod;
  inputSchema?: object;
}

// Read a strict, single-value base64 header. Any deviation from the
// canonical shape (multiple values, non-string, oversize, non-base64) is a
// hard reject with 400 — we do NOT silently coerce arrays or accept
// garbage. The empty-header case (undefined) is handled by the caller as
// "no signature — emit 402 challenge".
const MAX_PAYMENT_SIG_LEN = 4096;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

const readBase64HeaderStrict = (
  req: FastifyRequest,
  reply: FastifyReply,
  name: string
): { kind: 'missing' } | { kind: 'ok'; value: string } | { kind: 'error' } => {
  const raw = req.headers[name.toLowerCase()];
  if (raw === undefined) return { kind: 'missing' };
  if (Array.isArray(raw)) {
    handleError(
      reply,
      400,
      `${name} must be a single string header`,
      AmberErrorCodes.BAD_INPUT,
      null,
      null,
      { skipContextPersistence: true }
    );
    return { kind: 'error' };
  }
  if (typeof raw !== 'string') {
    handleError(
      reply,
      400,
      `${name} must be a single string header`,
      AmberErrorCodes.BAD_INPUT,
      null,
      null,
      { skipContextPersistence: true }
    );
    return { kind: 'error' };
  }
  if (raw.length === 0) {
    handleError(
      reply,
      400,
      `${name} must not be empty`,
      AmberErrorCodes.BAD_INPUT,
      null,
      null,
      { skipContextPersistence: true }
    );
    return { kind: 'error' };
  }
  if (raw.length > MAX_PAYMENT_SIG_LEN) {
    handleError(
      reply,
      413,
      `${name} too long`,
      AmberErrorCodes.BAD_INPUT,
      null,
      null,
      { skipContextPersistence: true }
    );
    return { kind: 'error' };
  }
  if (!BASE64_RE.test(raw)) {
    handleError(
      reply,
      400,
      `${name} is not valid base64`,
      AmberErrorCodes.BAD_INPUT,
      null,
      null,
      { skipContextPersistence: true }
    );
    return { kind: 'error' };
  }
  return { kind: 'ok', value: raw };
};

const send402Challenge = (
  req: FastifyRequest,
  reply: FastifyReply,
  opts: X402ExactOpts
): X402Result => {
  const url = `${PUBLIC_BASE_URL || `${req.protocol}://${req.hostname}`}${req.url.split('?')[0]}`;
  const challenge = buildExactChallenge({
    url,
    method: opts.method ?? 'POST',
    priceAtomic: opts.priceAtomic,
    inputSchema: opts.inputSchema,
  });
  reply.header('PAYMENT-REQUIRED', encodeChallenge(challenge));
  // OKX Onchain OS dispatcher checks headers in strict priority order:
  //   1. WWW-Authenticate: Payment  → MPP charge/session intent
  //   2. PAYMENT-REQUIRED           → x402 v2 accepts-based
  //   3. Body x402Version           → legacy v1
  // Emitting WWW-Authenticate makes AMBER a first-class citizen in the
  // dispatcher priority lane. The scheme still resolves through PAYMENT-REQUIRED
  // because AMBER uses x402 v2 exact — MPP is not activated by this header
  // alone; it just signals "there is a payment challenge on this response."
  reply.header(
    'WWW-Authenticate',
    `Payment realm="AMBER", scheme="x402-exact", network="eip155:${XLAYER_CHAIN_ID}", version="2"`
  );
  reply.code(402).send({
    success: false,
    error: { code: AmberErrorCodes.PAYMENT_REQUIRED, message: 'Payment required' },
    data: null,
    timestamp: new Date().toISOString(),
  });
  return 'reply-sent';
};

const shortNonce = (nonce: string): string => {
  return nonce.length > 10 ? `${nonce.slice(0, 6)}..${nonce.slice(-4)}` : nonce;
};

export const x402Exact = async (
  req: FastifyRequest,
  reply: FastifyReply,
  opts: X402ExactOpts
): Promise<X402Result> => {
  const identityInBody = opts.identityInBody.toLowerCase();
  const preAuthOpts = { skipContextPersistence: true };

  // -----------------------------------------------------------------------
  // Path A — x402 `period` scheme via APP-Access header.
  //
  // If the caller presents APP-Access we do NOT require a fresh EIP-3009
  // signature. Instead we verify the HMAC-signed token, debit the linked
  // subscription atomically, and short-circuit as authorized. On invalid /
  // expired / exhausted -> fall through to a fresh 402 challenge (do NOT
  // reveal whether the token was invalid vs. expired).
  // -----------------------------------------------------------------------
  const appAccessRaw = req.headers['app-access'];
  const appAccess = Array.isArray(appAccessRaw) ? appAccessRaw[0] : appAccessRaw;
  if (typeof appAccess === 'string' && appAccess.length > 0) {
    const payload = verifyAppAccessToken(appAccess);
    if (!payload) {
      return send402Challenge(req, reply, opts);
    }
    // H3 fix: pass identityInBody so debitSubscription can verify the
    // subscription belongs to this identity (prevents cross-identity spend).
    const debit = await debitSubscription(
      payload.subscriptionId,
      BigInt(opts.priceAtomic),
      identityInBody
    );
    if (!debit.ok) {
      return send402Challenge(req, reply, opts);
    }

    // Synthetic PaymentReceipt: no on-chain settle needed for `period`.
    let subIdentityRow;
    try {
      subIdentityRow = await getOrCreateIdentity(identityInBody);
    } catch (err) {
      await handleError(
        reply,
        500,
        'failed to resolve identity',
        AmberErrorCodes.INTERNAL,
        err as Error
      );
      return 'reply-sent';
    }

    try {
      await prismaQuery.paymentReceipt.create({
        data: {
          identityId: subIdentityRow.id,
          endpoint: opts.endpoint,
          scheme: 'period',
          mode: 'period',
          amountAtomic: BigInt(opts.priceAtomic),
          payer: identityInBody,
          authorization: {
            subscriptionId: payload.subscriptionId,
            expiresAtMs: payload.expiresAtMs,
          },
          signature: '',
          subscriptionId: payload.subscriptionId,
        },
      });
    } catch (err) {
      await handleError(
        reply,
        500,
        'failed to persist payment receipt',
        AmberErrorCodes.INTERNAL,
        err as Error
      );
      return 'reply-sent';
    }

    req.amberPayment = {
      payer: identityInBody,
      nonce: `sub:${payload.subscriptionId}`,
      amountAtomic: BigInt(opts.priceAtomic),
      endpoint: opts.endpoint,
    };
    reply.header('X-Amber-Payment-Mode', 'period');
    // x402 v2 PAYMENT-RESPONSE for period scheme.
    const periodResponse = Buffer.from(
      JSON.stringify({
        status: 'settled',
        transaction: `sub:${payload.subscriptionId}`,
        amount: String(opts.priceAtomic),
        payer: identityInBody,
      }),
      'utf8'
    ).toString('base64');
    reply.header('PAYMENT-RESPONSE', periodResponse);
    // Direct URL — clients can pass this straight through to a browser without
    // any string parsing. Encodes the review target, prefilled subject, and
    // the AMBER ASP identifier so the review lands on the right agent.
    reply.header(
      'X-Amber-Review',
      'https://www.okx.ai/marketplace?search=AMBER&prefill_review=1&subject=Great+persistent+memory+for+OKX+AI+agents'
    );
    return 'ok';
  }

  // -----------------------------------------------------------------------
  // Path B — classic x402 `exact` scheme via PAYMENT-SIGNATURE header.
  // -----------------------------------------------------------------------
  // Strict header validation — reject any deviation from the canonical shape
  // BEFORE we hit the parser. The DecodeError path below still catches
  // structurally-valid-base64 that fails to JSON-decode into the expected shape.
  const headerResult = readBase64HeaderStrict(req, reply, 'PAYMENT-SIGNATURE');
  if (headerResult.kind === 'error') return 'reply-sent';
  if (headerResult.kind === 'missing') {
    return send402Challenge(req, reply, opts);
  }
  const sigHeader = headerResult.value;

  let parsed;
  try {
    parsed = decodeReply(sigHeader);
  } catch (err) {
    const message = err instanceof DecodeError ? err.message : 'malformed payment reply';
    await handleError(reply, 402, message, AmberErrorCodes.PAYMENT_INVALID, null, null, preAuthOpts);
    return 'reply-sent';
  }

  if (parsed.scheme !== 'exact' || parsed.network !== `eip155:${XLAYER_CHAIN_ID}`) {
    await handleError(
      reply,
      402,
      `unsupported scheme or network (got ${parsed.scheme}/${parsed.network})`,
      AmberErrorCodes.PAYMENT_INVALID,
      null,
      null,
      preAuthOpts
    );
    return 'reply-sent';
  }

  const auth = parsed.payload.authorization;
  const signature = parsed.payload.signature;

  let recovered: string;
  try {
    recovered = verifyEip3009(
      {
        from: auth.from,
        to: auth.to,
        value: auth.value,
        validAfter: auth.validAfter,
        validBefore: auth.validBefore,
        nonce: auth.nonce,
      },
      signature
    );
  } catch (err) {
    await handleError(
      reply,
      402,
      'signature verification failed',
      AmberErrorCodes.PAYMENT_INVALID,
      err as Error,
      { payer: auth.from.toLowerCase(), nonce: shortNonce(auth.nonce) },
      preAuthOpts
    );
    return 'reply-sent';
  }

  if (recovered !== auth.from.toLowerCase() || recovered !== identityInBody) {
    await handleError(
      reply,
      401,
      'payer does not match identity',
      AmberErrorCodes.IDENTITY_INVALID,
      null,
      { recovered, from: auth.from.toLowerCase(), identity: identityInBody },
      preAuthOpts
    );
    return 'reply-sent';
  }

  if (auth.to.toLowerCase() !== ASP_WALLET_ADDRESS.toLowerCase()) {
    await handleError(
      reply,
      402,
      'payTo mismatch',
      AmberErrorCodes.PAYMENT_INVALID,
      null,
      { got: auth.to.toLowerCase(), want: ASP_WALLET_ADDRESS.toLowerCase() },
      preAuthOpts
    );
    return 'reply-sent';
  }

  let value: bigint;
  try {
    value = BigInt(auth.value);
  } catch {
    await handleError(
      reply,
      402,
      'authorization.value is not an integer',
      AmberErrorCodes.PAYMENT_INVALID,
      null,
      null,
      preAuthOpts
    );
    return 'reply-sent';
  }
  if (value !== BigInt(opts.priceAtomic)) {
    await handleError(
      reply,
      402,
      `amount mismatch: expected ${opts.priceAtomic}, got ${auth.value}`,
      AmberErrorCodes.PAYMENT_INVALID,
      null,
      null,
      preAuthOpts
    );
    return 'reply-sent';
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = Number(auth.validAfter);
  const validBefore = Number(auth.validBefore);
  if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) {
    await handleError(
      reply,
      402,
      'authorization window is not numeric',
      AmberErrorCodes.PAYMENT_INVALID,
      null,
      null,
      preAuthOpts
    );
    return 'reply-sent';
  }
  if (nowSec + CLOCK_SKEW_SECONDS < validAfter) {
    await handleError(
      reply,
      402,
      'authorization not yet valid',
      AmberErrorCodes.PAYMENT_INVALID,
      null,
      null,
      preAuthOpts
    );
    return 'reply-sent';
  }
  if (nowSec - CLOCK_SKEW_SECONDS > validBefore) {
    await handleError(
      reply,
      402,
      'authorization expired',
      AmberErrorCodes.PAYMENT_INVALID,
      null,
      null,
      preAuthOpts
    );
    return 'reply-sent';
  }

  // Nonce dedupe — Redis fast path, fail closed on Redis error.
  // H1 fix: include chainId + signer address so two different payers using the
  // same 32-byte nonce value don't collide (EIP-3009 nonces are per-signer).
  const nonceLower = auth.nonce.toLowerCase();
  const nonceKey = `nonce:${XLAYER_CHAIN_ID}:${recovered}:${nonceLower}`;
  let setNx: string | null;
  try {
    setNx = await redis.set(nonceKey, '1', 'EX', NONCE_TTL_SECONDS, 'NX');
  } catch (err) {
    await handleError(
      reply,
      500,
      'nonce dedupe backend unavailable',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
    return 'reply-sent';
  }
  if (setNx !== 'OK') {
    await handleError(
      reply,
      402,
      'nonce replay',
      AmberErrorCodes.PAYMENT_INVALID,
      null,
      { nonce: shortNonce(nonceLower) },
      preAuthOpts
    );
    return 'reply-sent';
  }

  // Durable dedupe.
  try {
    await prismaQuery.paymentNonce.create({
      data: {
        nonce: Buffer.from(nonceLower.replace(/^0x/, ''), 'hex'),
        fromAddress: recovered,
        chainId: XLAYER_CHAIN_ID,
        expiresAt: new Date((validBefore + 300) * 1000),
      },
    });
  } catch (err) {
    // Prisma unique-violation code is P2002. On collision, treat as replay.
    if ((err as { code?: string }).code === 'P2002') {
      await handleError(
        reply,
        402,
        'nonce replay (durable)',
        AmberErrorCodes.PAYMENT_INVALID,
        null,
        null,
        preAuthOpts
      );
      return 'reply-sent';
    }
    await handleError(
      reply,
      500,
      'failed to persist payment nonce',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
    return 'reply-sent';
  }

  // Persist the receipt BEFORE returning success.
  let identityRow;
  try {
    identityRow = await getOrCreateIdentity(identityInBody);
  } catch (err) {
    await handleError(
      reply,
      500,
      'failed to resolve identity',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
    return 'reply-sent';
  }

  try {
    await prismaQuery.paymentReceipt.create({
      data: {
        identityId: identityRow.id,
        endpoint: opts.endpoint,
        scheme: 'exact',
        mode: 'exact',
        amountAtomic: BigInt(opts.priceAtomic),
        payer: recovered,
        nonce: Buffer.from(nonceLower.replace(/^0x/, ''), 'hex'),
        authorization: {
          from: auth.from.toLowerCase(),
          to: auth.to.toLowerCase(),
          value: auth.value,
          validAfter: auth.validAfter,
          validBefore: auth.validBefore,
          nonce: nonceLower,
        },
        signature,
        txHash: null,
      },
    });
  } catch (err) {
    await handleError(
      reply,
      500,
      'failed to persist payment receipt',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
    return 'reply-sent';
  }

  req.amberPayment = {
    payer: recovered,
    nonce: nonceLower,
    amountAtomic: BigInt(opts.priceAtomic),
    endpoint: opts.endpoint,
  };

  // x402 v2 PAYMENT-RESPONSE: base64(JSON) with status/transaction/amount/payer.
  // "transaction" holds the hex-encoded keccak256 receipt fingerprint (no on-chain
  // settlement for exact scheme — txHash is null until the ASP sweeps the batch).
  const receiptHashHex = `0x${Buffer.from(
    keccak_256(Buffer.from(`${identityRow.id}:${nonceLower}`, 'utf8'))
  ).toString('hex')}`;
  const paymentResponse = Buffer.from(
    JSON.stringify({
      status: 'settled',
      transaction: receiptHashHex,
      amount: String(opts.priceAtomic),
      payer: recovered,
    }),
    'utf8'
  ).toString('base64');
  reply.header('PAYMENT-RESPONSE', paymentResponse);
  reply.header(
    'X-Amber-Review',
    'https://www.okx.ai/marketplace?search=AMBER&prefill_review=1&subject=Great+persistent+memory+for+OKX+AI+agents'
  );

  return 'ok';
};
