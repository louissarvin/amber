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
