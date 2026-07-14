import { prismaQuery } from '../lib/prisma.ts';
import { getOrCreateIdentity } from './identity.ts';
import type { QueryHit, AttestationInline } from './memoryQuery.ts';
import { UNTRUSTED_MEMORY_FRAME } from '../lib/memorySanitize.ts';

// -----------------------------------------------------------------------------
// Session context — cheap recency-only fetch (no embedding).
// -----------------------------------------------------------------------------

export interface SessionContextInput {
  identityAddress: string;
  limit: number;
}

export interface SessionContextResult {
  safetyFrame: string;
  memories: QueryHit[];
  totalMemories: number;
}

export const fetchSessionContext = async (
  input: SessionContextInput
): Promise<SessionContextResult> => {
  const identity = await getOrCreateIdentity(input.identityAddress);

  const [pinnedRows, recentRows, total] = await Promise.all([
    prismaQuery.memory.findMany({
      where: { identityId: identity.id, deletedAt: null, tags: { has: 'pinned' } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(10, input.limit),
      include: { attestation: true },
    }),
    prismaQuery.memory.findMany({
      where: { identityId: identity.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      include: { attestation: true },
    }),
    prismaQuery.memory.count({
      where: { identityId: identity.id, deletedAt: null },
    }),
  ]);

  // Pinned first (Best Product: durable identity facts), then recent, de-dupe.
  const seen = new Set<string>();
  const rows = [...pinnedRows, ...recentRows]
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .slice(0, input.limit);

  const memories: QueryHit[] = rows.map((row) => {
    const attestation: AttestationInline = row.attestation
      ? {
          chainId: row.attestation.chainId,
          txHash: row.attestation.txHash,
          merkleRoot: row.attestation.merkleRoot
            ? `0x${Buffer.from(row.attestation.merkleRoot).toString('hex')}`
            : null,
          status: row.attestation.status as 'pending' | 'submitted' | 'attested' | 'failed',
          attestedAt: row.attestation.attestedAt ? row.attestation.attestedAt.toISOString() : null,
        }
      : {
          chainId: 196,
          txHash: null,
          merkleRoot: null,
          status: 'pending',
          attestedAt: null,
        };

    return {
      memoryId: row.id,
      content: row.content,
      category: row.category,
      tags: row.tags,
      createdAt: row.createdAt.toISOString(),
      relevance: 1,
      attestation,
    };
  });

  return { safetyFrame: UNTRUSTED_MEMORY_FRAME, memories, totalMemories: total };
};
