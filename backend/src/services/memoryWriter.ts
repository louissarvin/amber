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
  // freeUsed += 1 committed. If it did not match (identity is at cap), the
  // caller must have completed x402 payment before invoking writeOne.
  //
  // Trade-off: if the subsequent Memory insert fails, we've lost one free
  // slot for this identity. Acceptable — counters are monotonically
  // non-decreasing and can never exceed the cap. Better than the previous
  // read-then-write pattern which allowed a TOCTOU race under concurrency.
  let mode: WriteMode;
  if (input.paymentMode === 'paid') {
    // Caller already ran x402 — do not consume a free slot.
    mode = 'paid';
  } else {
    const consume = await tryConsumeFreeWrite(identity.address);
    if (consume.consumed) {
      mode = 'free';
    } else if (input.paymentMode === 'free') {
      // Caller thought this was free, but the atomic reservation failed
      // (race lost). We MUST NOT silently write without payment. Surface
      // a retryable error so the caller can re-run with x402.
      throw Object.assign(
        new Error('free-tier capacity exhausted, retry with x402 payment'),
        { code: 'QUOTA_RACE_LOST' }
      );
    } else {
      // Undeclared caller (legacy) and no free slot → paid path required.
      // In this case the caller MUST have run x402 upstream; if not, we
      // still refuse to write.
      throw Object.assign(
        new Error('free-tier capacity exhausted, x402 payment required'),
        { code: 'QUOTA_RACE_LOST' }
      );
    }
  }

  const memoryId = crypto.randomUUID();
  const contentHash = keccak256Utf8(safeContent);
  const embedding = await embed(safeContent);

  // Guard: reject malformed embeddings before SQL interpolation (C1 defense).
  if (!embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('embedding contains non-finite values; aborting memory write');
  }

  const vecLiteral = `[${embedding.join(',')}]`;

  const category = input.category;
  const tags = input.tags;
  const metadata =
    sanitized.flags.length > 0
      ? { ...input.metadata, sanitizeFlags: sanitized.flags }
      : input.metadata;

  await prismaQuery.$executeRawUnsafe(
    `INSERT INTO "Memory" (id, "identityId", content, "contentHash", category, tags, metadata, "clientNonce", embedding, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::"MemoryCategory", $6::text[], $7::jsonb, $8, $9::vector, NOW(), NOW())`,
    memoryId,
    identity.id,
    safeContent,
    contentHash,
    category,
    tags,
    JSON.stringify(metadata),
    input.clientNonce,
    vecLiteral
  );

  // Paid-write telemetry: quota already bumped atomically for free path,
  // so only bump paidWrites here for the paid path. Best-effort.
  if (mode === 'paid') {
    await bumpPaidWrite(quota.id, PRICE_WRITE_ATOMIC);
  }

  await enqueuePending({
    memoryId,
    identityAddress: identity.address,
    contentHash: `0x${contentHash.toString('hex')}`,
    category,
    createdAtUnix: Math.floor(Date.now() / 1000),
  });

  const refreshedQuota = await getOrCreateQuota(identity.id);

  console.log('[memoryWriter] wrote', {
    memoryId,
    identity: identity.address,
    mode,
    contentPreview: truncate(safeContent, 100),
  });

  // Invalidate portrait cache so next GET /portrait/:address.svg reflects new memory.
  bustPortraitCache(identity.address).catch((err: Error) => {
    console.warn('[memoryWriter] portrait cache bust failed:', err.message);
  });

  return {
    memoryId,
    createdAt: new Date().toISOString(),
    mode,
    freeRemaining: freeRemaining(refreshedQuota),
    replay: false,
  };
};

export interface BulkWriteResult {
  memoryIds: string[];
  perItem: Array<
    | { ok: true; memoryId: string; index: number }
    | { ok: false; index: number; code: string; message: string }
  >;
}

export interface BulkWriteQuotaSplit {
  paidItems: number;
  freeItems: number;
}

export const writeBulk = async (
  identityAddress: string,
  items: Array<Omit<WriteInput, 'identityAddress'>>,
  quotaSplit: BulkWriteQuotaSplit = { paidItems: 0, freeItems: 0 }
): Promise<BulkWriteResult> => {
  const identity = await getOrCreateIdentity(identityAddress);
  const quota = await getOrCreateQuota(identity.id);

  const sanitizedItems: Array<(Omit<WriteInput, 'identityAddress'> & { content: string }) | null> =
    items.map((it) => {
      const s = sanitizeMemoryContent(it.content);
      if (!s.ok) return null;
      return {
        ...it,
        content: s.content,
        metadata: s.flags.length > 0 ? { ...it.metadata, sanitizeFlags: s.flags } : it.metadata,
      };
    });

  // Use allSettled so a single embed failure marks only that item as failed
  // rather than aborting the whole batch (Promise.all would reject on first error).
  const embedResults = await Promise.allSettled(
    sanitizedItems.map(async (it) => (it ? embed(it.content) : null))
  );
  const embeddings: Array<number[] | null> = embedResults.map((r) =>
    r.status === 'fulfilled' ? r.value : null
  );

  const perItem: BulkWriteResult['perItem'] = [];
  const memoryIds: string[] = [];

  // Run inserts independently (NOT inside a shared $transaction) so that a single
  // PostgreSQL error does not abort the connection and cause every subsequent INSERT
  // in the same batch to fail with "current transaction is aborted".
  for (let i = 0; i < items.length; i++) {
    const item = sanitizedItems[i];
    if (!item || !embeddings[i]) {
      const rejected = sanitizeMemoryContent(items[i]?.content ?? '');
      perItem.push({
        ok: false,
        index: i,
        code: rejected.ok ? 'BAD_INPUT' : rejected.code,
        message: rejected.ok ? 'sanitize failed' : rejected.message,
      });
      continue;
    }
    const memoryId = crypto.randomUUID();
    const contentHash = keccak256Utf8(item.content);
    const vecLiteral = `[${embeddings[i]!.join(',')}]`;
    try {
      await prismaQuery.$executeRawUnsafe(
        `INSERT INTO "Memory" (id, "identityId", content, "contentHash", category, tags, metadata, "clientNonce", embedding, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::"MemoryCategory", $6::text[], $7::jsonb, $8, $9::vector, NOW(), NOW())`,
        memoryId,
        identity.id,
        item.content,
        contentHash,
        item.category,
        item.tags,
        JSON.stringify(item.metadata),
        item.clientNonce,
        vecLiteral
      );
      memoryIds.push(memoryId);
      perItem.push({ ok: true, memoryId, index: i });
    } catch (err) {
      perItem.push({
        ok: false,
        index: i,
        code: 'INTERNAL',
        message: (err as Error).message,
      });
    }
  }

  // Quota accounting AFTER the transaction. We only count successful inserts,
  // and we apply the split proportionally across free/paid buckets.
  const successCount = perItem.filter((p) => p.ok).length;
  const requestedTotal = quotaSplit.freeItems + quotaSplit.paidItems;
  if (successCount > 0 && requestedTotal > 0) {
    const freeApplied = Math.min(quotaSplit.freeItems, successCount);
    const paidApplied = Math.min(quotaSplit.paidItems, successCount - freeApplied);

    for (let i = 0; i < freeApplied; i++) {
      const result = await tryConsumeFreeWrite(identity.address);
      if (!result.consumed) break;
    }
    if (paidApplied > 0) {
      await bumpPaidWrites(quota.id, paidApplied, PRICE_WRITE_ATOMIC);
    }
  }

  // Enqueue pending attestations outside the transaction.
  for (let i = 0; i < items.length; i++) {
    const item = sanitizedItems[i];
    const outcome = perItem[i];
    if (!outcome || !outcome.ok || !item) continue;
    await enqueuePending({
      memoryId: outcome.memoryId,
      identityAddress: identity.address,
      contentHash: `0x${keccak256Utf8(item.content).toString('hex')}`,
      category: item.category,
      createdAtUnix: Math.floor(Date.now() / 1000),
    });
  }

  bustPortraitCache(identity.address).catch((err: Error) => {
    console.warn('[memoryWriter] portrait cache bust failed:', err.message);
  });

  return { memoryIds, perItem };
};
