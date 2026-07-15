import { prismaQuery } from '../lib/prisma.ts';
import { getOrCreateIdentity } from './identity.ts';
import { writeOne } from './memoryWriter.ts';
import { FREE_TIER_WRITES_PER_IDENTITY } from '../config/main-config.ts';
import { getOrCreateQuota, hasFreeCapacity } from '../lib/quota/service.ts';

// -----------------------------------------------------------------------------
// Memory Share — copy selected memories from one ERC-8004 identity to another.
// Official AMBER maximize: portable identity means graphs can move/share without
// XMTP. Ownership is enforced on the source; destination gets a new write with
// provenance tags. Never exposes embedding rows cross-tenant without explicit
// share.
// -----------------------------------------------------------------------------

export interface ShareMemoriesInput {
  fromIdentity: string;
  toIdentity: string;
  memoryIds: string[];
}

export interface ShareMemoriesResult {
  shared: number;
  memoryIds: string[];
  skipped: Array<{ memoryId: string; reason: string }>;
}

export const shareMemories = async (
  input: ShareMemoriesInput
): Promise<ShareMemoriesResult> => {
  const from = input.fromIdentity.toLowerCase();
  const to = input.toIdentity.toLowerCase();
  if (from === to) {
    const err = new Error('fromIdentity and toIdentity must differ') as Error & {
      code: string;
    };
    err.code = 'BAD_INPUT';
    throw err;
  }
  if (input.memoryIds.length === 0 || input.memoryIds.length > 20) {
    const err = new Error('memoryIds must contain 1–20 ids') as Error & { code: string };
    err.code = 'BAD_INPUT';
    throw err;
  }

  const source = await getOrCreateIdentity(from);
  const dest = await getOrCreateIdentity(to);

  const rows = await prismaQuery.memory.findMany({
    where: {
      id: { in: input.memoryIds },
      identityId: source.id,
      deletedAt: null,
    },
    select: {
      id: true,
      content: true,
      category: true,
      tags: true,
      metadata: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const quota = await getOrCreateQuota(dest.id);
  let freeLeft = Math.max(0, FREE_TIER_WRITES_PER_IDENTITY - quota.freeUsed);

  const memoryIds: string[] = [];
  const skipped: Array<{ memoryId: string; reason: string }> = [];

  for (const id of input.memoryIds) {
    const row = byId.get(id);
    if (!row) {
      skipped.push({ memoryId: id, reason: 'not_found_or_forbidden' });
      continue;
    }
    const paymentMode = freeLeft > 0 ? 'free' : 'paid';
    if (paymentMode === 'free') freeLeft -= 1;

    const meta =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, string | number | boolean>)
        : {};

    const result = await writeOne({
      identityAddress: to,
      content: row.content,
      category: row.category,
      tags: Array.from(new Set([...(row.tags ?? []), 'shared', `from:${from.slice(0, 10)}`])),
      metadata: {
        ...meta,
        sharedFrom: from,
        sharedMemoryId: row.id,
      },
      clientNonce: `share:${from}:${to}:${row.id}`,
      paymentMode,
    });
    memoryIds.push(result.memoryId);
  }

  return { shared: memoryIds.length, memoryIds, skipped };
};

export interface ConsolidateMemoriesInput {
  identityAddress: string;
  limit?: number;
}

export interface ConsolidateMemoriesResult {
  memoryId: string;
  sourceCount: number;
  content: string;
  freeRemaining: number;
}

/**
 * Deterministic consolidation — no LLM. Builds a system memory that lists the
 * most recent facts so agents get a compact "who am I" bootstrap without
 * another chatbot wrapper.
 */
export const consolidateMemories = async (
  input: ConsolidateMemoriesInput
): Promise<ConsolidateMemoriesResult> => {
  const address = input.identityAddress.toLowerCase();
  const limit = Math.min(40, Math.max(5, input.limit ?? 20));
  const identity = await getOrCreateIdentity(address);

  const rows = await prismaQuery.memory.findMany({
    where: { identityId: identity.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { content: true, category: true, createdAt: true },
  });

  if (rows.length === 0) {
    const err = new Error('no memories to consolidate') as Error & { code: string };
    err.code = 'MEMORY_NOT_FOUND';
    throw err;
  }

  const lines = rows.map((r, i) => {
    const snippet = r.content.replace(/\s+/g, ' ').trim().slice(0, 160);
    return `${i + 1}. [${r.category}] ${snippet}`;
  });

  const content = [
    `Consolidated memory dossier for ${address} (${rows.length} recent entries).`,
    `Generated at ${new Date().toISOString()}.`,
    '',
    ...lines,
  ].join('\n');

  const quota = await getOrCreateQuota(identity.id);
  const paymentMode = hasFreeCapacity(quota) ? 'free' : 'paid';

  const result = await writeOne({
    identityAddress: address,
    content,
    category: 'system',
    tags: ['consolidate', 'dossier'],
    metadata: { sourceCount: rows.length, kind: 'consolidate' },
    clientNonce: `consolidate:${address}:${rows[0]?.createdAt.toISOString() ?? 'x'}:${rows.length}`,
    paymentMode,
  });

  return {
    memoryId: result.memoryId,
    sourceCount: rows.length,
    content,
    freeRemaining: result.freeRemaining,
  };
};
