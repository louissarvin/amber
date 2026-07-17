import crypto from 'node:crypto';
import { verifyTypedData } from 'ethers';
import { prismaQuery } from '../lib/prisma.ts';
import { getOrCreateIdentity } from './identity.ts';
import {
  APP_ACCESS_HMAC_SECRET,
  ASP_WALLET_ADDRESS,
  SUBSCRIPTION_MAX_BUDGET_ATOMIC,
  XLAYER_CHAIN_ID,
} from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// x402 `period` scheme subscription service.
//
// Design choice (documented in docs/10_IMPLEMENTATION_NOTES.md D-13):
//
// The full Permit2 + SubscriptionTerms EIP-712 typed data schema is not
// documented in docs/01_ADR.md yet, so this implementation ships the
// simplified variant per the sprint brief:
//
//   Domain:  { name: "AMBER Subscription", version: "1",
//              chainId: XLAYER_CHAIN_ID, verifyingContract: ASP_WALLET_ADDRESS }
//   Types:   SubscriptionTerms {
//              identity address,
//              budgetAtomic uint256,
//              periodSeconds uint256,
//              nonce bytes32,
//              expiresAt uint256
//            }
//
// The permit2 signature field is preserved on the wire so we can rev to
// the full canonical schema later without breaking clients.
// -----------------------------------------------------------------------------

const SUBSCRIPTION_DOMAIN = {
  name: 'AMBER Subscription',
  version: '1',
  chainId: XLAYER_CHAIN_ID,
  verifyingContract: ASP_WALLET_ADDRESS,
} as const;

const SUBSCRIPTION_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  SubscriptionTerms: [
    { name: 'identity', type: 'address' },
    { name: 'budgetAtomic', type: 'uint256' },
    { name: 'periodSeconds', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint256' },
  ],
};

const CLOSE_DOMAIN = {
  name: 'AMBER Subscription',
  version: '1',
  chainId: XLAYER_CHAIN_ID,
  verifyingContract: ASP_WALLET_ADDRESS,
} as const;

const CLOSE_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  SubscriptionClose: [
    { name: 'subscriptionId', type: 'string' },
    { name: 'issuedAt', type: 'uint256' },
  ],
};

export interface OpenSubscriptionInput {
  identity: string;
  budgetAtomic: bigint;
  periodSeconds: number;
  permit2Nonce: string; // 0x + 64 hex
  permit2Signature: string; // 0x + 130 hex
}

export interface OpenSubscriptionResult {
  subscriptionId: string;
  expiresAt: string;
  appAccessToken: string;
  budgetAtomic: string;
  spentAtomic: string;
}

const decodeHexBytes32 = (hex: string): Buffer => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    const err = new Error('permit2Nonce must be 0x + 64 hex chars') as Error & { code: string };
    err.code = 'SUBSCRIPTION_BAD_INPUT';
    throw err;
  }
  return Buffer.from(clean, 'hex');
};

const signAppAccessToken = (subscriptionId: string, expiresAtMs: number): string => {
  const material = `${subscriptionId}:${expiresAtMs}`;
  const hmac = crypto
    .createHmac('sha256', APP_ACCESS_HMAC_SECRET)
    .update(material, 'utf8')
    .digest();
  // Emit token as base64url(subscriptionId | expiresAt | hmac)
  const payload = Buffer.from(JSON.stringify({ s: subscriptionId, e: expiresAtMs }), 'utf8');
  const combined = Buffer.concat([payload, Buffer.from(':', 'utf8'), hmac]);
  return combined.toString('base64url');
};

export interface AppAccessTokenPayload {
  subscriptionId: string;
  expiresAtMs: number;
}

// Timing-safe HMAC verification. Returns null when invalid or malformed.
export const verifyAppAccessToken = (token: string): AppAccessTokenPayload | null => {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return null;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(token, 'base64url');
  } catch {
    return null;
  }
  // HMAC-SHA256 always produces exactly 32 bytes. The token layout is:
  //   [payload JSON bytes] [0x3A separator] [32 HMAC bytes]
  // Using indexOf(':') would land on the first colon INSIDE the JSON payload
  // (JSON keys contain ":"). Instead, slice from the end: last 32 bytes = HMAC,
  // byte before that must be the separator, everything before = payload.
  const HMAC_LEN = 32;
  if (decoded.length <= HMAC_LEN + 1) return null;
  const hmacBuf = decoded.subarray(decoded.length - HMAC_LEN);
  const sep = decoded[decoded.length - HMAC_LEN - 1];
  if (sep !== 0x3a) return null; // 0x3a = ':'
  const payloadBuf = decoded.subarray(0, decoded.length - HMAC_LEN - 1);

  let parsed: { s?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(payloadBuf.toString('utf8')) as { s?: unknown; e?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.s !== 'string' || typeof parsed.e !== 'number') return null;

  const expected = crypto
    .createHmac('sha256', APP_ACCESS_HMAC_SECRET)
    .update(`${parsed.s}:${parsed.e}`, 'utf8')
    .digest();

  if (expected.length !== hmacBuf.length) return null;
  if (!crypto.timingSafeEqual(expected, hmacBuf)) return null;

  return { subscriptionId: parsed.s, expiresAtMs: parsed.e };
};

export const openSubscription = async (
  input: OpenSubscriptionInput
): Promise<OpenSubscriptionResult> => {
  const identityAddr = input.identity.toLowerCase();
  const nowMs = Date.now();
  const expiresAtMs = nowMs + input.periodSeconds * 1000;

  // Server-side safety valve — refuse budgets we cannot cover.
  if (input.budgetAtomic <= 0n) {
    const err = new Error('budgetAtomic must be > 0') as Error & { code: string };
    err.code = 'SUBSCRIPTION_BAD_INPUT';
    throw err;
  }
  if (input.budgetAtomic > BigInt(SUBSCRIPTION_MAX_BUDGET_ATOMIC)) {
    const err = new Error('budgetAtomic exceeds ASP maximum') as Error & { code: string };
    err.code = 'SUBSCRIPTION_BAD_INPUT';
    throw err;
  }
  if (!Number.isInteger(input.periodSeconds) || input.periodSeconds < 60 || input.periodSeconds > 60 * 60 * 24 * 30) {
    const err = new Error('periodSeconds must be in [60, 2592000]') as Error & { code: string };
    err.code = 'SUBSCRIPTION_BAD_INPUT';
    throw err;
  }

  const nonceBytes = decodeHexBytes32(input.permit2Nonce);

  // EIP-712 verify (simplified schema, per D-13). The signer MUST be the
  // identity address itself.
  const message = {
    identity: identityAddr,
    budgetAtomic: input.budgetAtomic,
    periodSeconds: BigInt(input.periodSeconds),
    nonce: `0x${nonceBytes.toString('hex')}`,
    expiresAt: BigInt(Math.floor(expiresAtMs / 1000)),
  };

  let recovered: string;
  try {
    recovered = verifyTypedData(SUBSCRIPTION_DOMAIN, SUBSCRIPTION_TYPES, message, input.permit2Signature);
  } catch (err) {
    const wrapped = new Error(`subscription signature invalid: ${(err as Error).message}`) as Error & {
      code: string;
    };
    wrapped.code = 'SUBSCRIPTION_INVALID_SIGNATURE';
    throw wrapped;
  }

  if (recovered.toLowerCase() !== identityAddr) {
    const err = new Error('subscription signer does not match identity') as Error & { code: string };
    err.code = 'SUBSCRIPTION_INVALID_SIGNATURE';
    throw err;
  }

  const identity = await getOrCreateIdentity(identityAddr);

  const subscription = await prismaQuery.subscription.create({
    data: {
      identityId: identity.id,
      permit2Nonce: new Uint8Array(nonceBytes),
      budgetAtomic: input.budgetAtomic,
      spentAtomic: 0n,
      periodSeconds: input.periodSeconds,
      status: 'open',
      openedAt: new Date(nowMs),
      expiresAt: new Date(expiresAtMs),
    },
  });

  const appAccessToken = signAppAccessToken(subscription.id, expiresAtMs);

  return {
    subscriptionId: subscription.id,
    expiresAt: new Date(expiresAtMs).toISOString(),
    appAccessToken,
    budgetAtomic: subscription.budgetAtomic.toString(),
    spentAtomic: '0',
  };
};

export interface DebitResult {
  ok: boolean;
  remaining: bigint;
  reason?: 'NOT_FOUND' | 'CLOSED' | 'EXPIRED' | 'INSUFFICIENT_BUDGET' | 'IDENTITY_MISMATCH';
}

// Atomic conditional UPDATE. Only debits when the subscription is still
// open, not expired, and the additional charge fits within the remaining
// budget. Race-safe under concurrent requests to the same subscription.
//
// H3 fix: `ownerIdentityAddress` when provided is checked against the
// subscription's owner BEFORE the debit. This prevents a valid APP-Access
// token holder from spending another identity's subscription budget.
export const debitSubscription = async (
  subscriptionId: string,
  priceAtomic: bigint,
  ownerIdentityAddress?: string
): Promise<DebitResult> => {
  if (priceAtomic <= 0n) return { ok: false, remaining: 0n, reason: 'INSUFFICIENT_BUDGET' };

  // H3: verify subscription ownership before debiting.
  if (ownerIdentityAddress) {
    const sub = await prismaQuery.subscription.findUnique({
      where: { id: subscriptionId },
      select: { identity: { select: { address: true } } },
    });
    if (!sub) return { ok: false, remaining: 0n, reason: 'NOT_FOUND' };
    if (sub.identity.address.toLowerCase() !== ownerIdentityAddress.toLowerCase()) {
      return { ok: false, remaining: 0n, reason: 'IDENTITY_MISMATCH' };
    }
  }

  const rows = (await prismaQuery.$queryRawUnsafe(
    `UPDATE "Subscription"
     SET "spentAtomic" = "spentAtomic" + $2::bigint,
         "updatedAt" = NOW()
     WHERE "id" = $1
       AND "status" = 'open'
       AND "expiresAt" > NOW()
       AND "spentAtomic" + $2::bigint <= "budgetAtomic"
     RETURNING "budgetAtomic", "spentAtomic"`,
    subscriptionId,
    priceAtomic.toString()
  )) as Array<{ budgetAtomic: bigint; spentAtomic: bigint }>;

  if (rows.length > 0) {
    const row = rows[0]!;
    return { ok: true, remaining: row.budgetAtomic - row.spentAtomic };
  }

  // Diagnose why the debit failed for the caller. Read the current row and
  // classify — but do not leak details in the response (routes translate to
  // a generic PAYMENT_INVALID).
  const current = await prismaQuery.subscription.findUnique({
    where: { id: subscriptionId },
    select: { budgetAtomic: true, spentAtomic: true, status: true, expiresAt: true },
  });
  if (!current) return { ok: false, remaining: 0n, reason: 'NOT_FOUND' };
  if (current.status !== 'open') return { ok: false, remaining: 0n, reason: 'CLOSED' };
  if (current.expiresAt.getTime() <= Date.now()) {
    return { ok: false, remaining: current.budgetAtomic - current.spentAtomic, reason: 'EXPIRED' };
  }
  return {
    ok: false,
    remaining: current.budgetAtomic - current.spentAtomic,
    reason: 'INSUFFICIENT_BUDGET',
  };
};

export interface CloseSubscriptionInput {
  subscriptionId: string;
  identity: string;
  issuedAtUnix: number;
  signature: string;
}

// MVP does not refund on-chain. This is documented in
// docs/10_IMPLEMENTATION_NOTES.md — buyers approve a Permit2 budget the ASP
// bills against; unused budget stays with the buyer wallet. Closing simply
// stops the ASP from spending further.
export const closeSubscription = async (
  input: CloseSubscriptionInput
): Promise<{ subscriptionId: string; status: string; closedAt: string }> => {
  const sub = await prismaQuery.subscription.findUnique({
    where: { id: input.subscriptionId },
    include: { identity: { select: { address: true } } },
  });
  if (!sub) {
    const err = new Error('subscription not found') as Error & { code: string };
    err.code = 'SUBSCRIPTION_NOT_FOUND';
    throw err;
  }

  if (sub.identity.address.toLowerCase() !== input.identity.toLowerCase()) {
    const err = new Error('subscription owner mismatch') as Error & { code: string };
    err.code = 'SUBSCRIPTION_FORBIDDEN';
    throw err;
  }

  const message = {
    subscriptionId: input.subscriptionId,
    issuedAt: BigInt(input.issuedAtUnix),
  };

  let recovered: string;
  try {
    recovered = verifyTypedData(CLOSE_DOMAIN, CLOSE_TYPES, message, input.signature);
  } catch (err) {
    const wrapped = new Error(`close signature invalid: ${(err as Error).message}`) as Error & {
      code: string;
    };
    wrapped.code = 'SUBSCRIPTION_INVALID_SIGNATURE';
    throw wrapped;
  }
  if (recovered.toLowerCase() !== input.identity.toLowerCase()) {
    const err = new Error('close signer does not match identity') as Error & { code: string };
    err.code = 'SUBSCRIPTION_INVALID_SIGNATURE';
    throw err;
  }

  // Guard against stale signatures (older than 5 minutes).
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.issuedAtUnix) > 300) {
    const err = new Error('close signature expired or clock skew') as Error & { code: string };
    err.code = 'SUBSCRIPTION_INVALID_SIGNATURE';
    throw err;
  }

  const now2 = new Date();
  const updated = await prismaQuery.subscription.update({
    where: { id: input.subscriptionId },
    data: { status: 'closed', closedAt: now2 },
    select: { id: true, status: true, closedAt: true },
  });

  return {
    subscriptionId: updated.id,
    status: updated.status,
    closedAt: (updated.closedAt ?? now2).toISOString(),
  };
};

export interface SubscriptionPublicView {
  status: string;
  remainingBudgetAtomic: string;
  expiresAt: string;
  openedAt: string;
  closedAt: string | null;
}

export const getSubscriptionPublic = async (
  subscriptionId: string
): Promise<SubscriptionPublicView | null> => {
  const sub = await prismaQuery.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      budgetAtomic: true,
      spentAtomic: true,
      status: true,
      openedAt: true,
      expiresAt: true,
      closedAt: true,
    },
  });
  if (!sub) return null;
  return {
    status: sub.status,
    remainingBudgetAtomic: (sub.budgetAtomic - sub.spentAtomic).toString(),
    expiresAt: sub.expiresAt.toISOString(),
    openedAt: sub.openedAt.toISOString(),
    closedAt: sub.closedAt ? sub.closedAt.toISOString() : null,
  };
};
