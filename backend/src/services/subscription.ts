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
