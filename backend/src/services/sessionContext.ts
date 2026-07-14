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
