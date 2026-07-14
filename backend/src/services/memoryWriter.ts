import crypto from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3';
import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import { embed } from '../lib/openai/embeddings.ts';
import { getOrCreateIdentity } from './identity.ts';
import { bumpPaidWrite, bumpPaidWrites, getOrCreateQuota, freeRemaining, tryConsumeFreeWrite } from '../lib/quota/service.ts';
import { bustPortraitCache } from './portraitService.ts';
import { PRICE_WRITE_ATOMIC } from '../config/main-config.ts';
import { sanitizeMemoryContent } from '../lib/memorySanitize.ts';

// -----------------------------------------------------------------------------
// Memory writer service — shared by REST + MCP paths.
//
// The x402 verify step happens BEFORE this service is called. All this
// function does is embed, insert, bump quota, enqueue attestation.
//
// Idempotency (`clientNonce`) is checked by the caller too — we duplicate
// the check here so MCP callers (which don't invoke the REST handler) get the
// same guarantee.
// -----------------------------------------------------------------------------

export type WriteMode = 'free' | 'paid';

export interface WriteInput {
  identityAddress: string; // lowercased
  content: string;
  category: string;
  tags: string[];
  metadata: Record<string, string | number | boolean | string[]>;
  clientNonce: string | null;
  // Explicit intent from the caller: was this write already gated by x402?
  //   - 'free': caller believed the identity has free capacity; writeOne
  //     MUST NOT fall back to paid mode if the atomic reservation loses
  //     the race — instead it throws QUOTA_EXCEEDED so the handler can
  //     tell the client to retry (which triggers x402).
  //   - 'paid': caller already ran x402 successfully; the payment is
  //     recorded. writeOne skips the free-tier reservation entirely.
  //   - undefined: legacy callers (MCP path) still perform the atomic
  //     dance internally.
  paymentMode?: 'free' | 'paid';
}

export interface WriteResult {
  memoryId: string;
  createdAt: string;
  mode: WriteMode;
  freeRemaining: number;
  replay: boolean;
}

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n)}…`;

const keccak256Utf8 = (s: string): Buffer =>
  Buffer.from(keccak_256(Buffer.from(s, 'utf8')));

const enqueuePending = async (payload: {
  memoryId: string;
  identityAddress: string;
  contentHash: string;
  category: string;
  createdAtUnix: number;
}): Promise<void> => {
  try {
    await redis.rpush('pending:attestations', JSON.stringify(payload));
  } catch (err) {
    console.warn('[memoryWriter] failed to enqueue pending attestation:', (err as Error).message);
  }
};

export const writeOne = async (input: WriteInput): Promise<WriteResult> => {
  const sanitized = sanitizeMemoryContent(input.content);
  if (!sanitized.ok) {
    throw Object.assign(new Error(sanitized.message), {
      code: sanitized.code,
      flags: sanitized.flags,
    });
  }
  const safeContent = sanitized.content;

  const identity = await getOrCreateIdentity(input.identityAddress);

  // Idempotent replay.
  if (input.clientNonce) {
    const existing = await prismaQuery.memory.findFirst({
      where: {
        identityId: identity.id,
        clientNonce: input.clientNonce,
        deletedAt: null,
      },
    });
    if (existing) {
      if (existing.content !== safeContent) {
        throw Object.assign(
          new Error('clientNonce reused with different content'),
          { code: 'BAD_INPUT_CONFLICT' }
        );
      }
      const quota = await getOrCreateQuota(identity.id);
      return {
        memoryId: existing.id,
        createdAt: existing.createdAt.toISOString(),
        mode: 'free', // The original mode is not stored; free is the safe display.
        freeRemaining: freeRemaining(quota),
        replay: true,
      };
    }
  }

  // Ensure a Quota row exists — tryConsumeFreeWrite requires it.
  const quota = await getOrCreateQuota(identity.id);

  // Atomic free-tier reservation. If the UPDATE matched, the row already has
