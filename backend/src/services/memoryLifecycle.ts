import { prismaQuery } from '../lib/prisma.ts';
import { getOrCreateIdentity } from './identity.ts';
import {
  attestationRefFromMemoryId,
  pendingAttestationRef,
  type AttestationRef,
} from './attestationRef.ts';

// -----------------------------------------------------------------------------
// List + soft-delete — architecture §REST surface (list, delete).
// Ownership is always keyed by identity address; never expose cross-tenant rows.
// -----------------------------------------------------------------------------

export interface ListMemoriesInput {
  identityAddress: string;
  limit: number;
  cursor: string | null; // ISO createdAt cursor (exclusive upper bound)
  category: string | null;
}

export interface ListedMemory {
  memoryId: string;
  content: string;
  category: string;
  tags: string[];
  createdAt: string;
  attestation: AttestationRef;
}

export interface ListMemoriesResult {
  memories: ListedMemory[];
  nextCursor: string | null;
  total: number;
}

export const listMemories = async (input: ListMemoriesInput): Promise<ListMemoriesResult> => {
  const identity = await getOrCreateIdentity(input.identityAddress);

  const where = {
    identityId: identity.id,
    deletedAt: null as Date | null,
    ...(input.category ? { category: input.category as never } : {}),
    ...(input.cursor ? { createdAt: { lt: new Date(input.cursor) } } : {}),
  };

  const [rows, total] = await Promise.all([
    prismaQuery.memory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      include: {
        attestation: {
          select: {
            chainId: true,
            txHash: true,
            merkleRoot: true,
            status: true,
            attestedAt: true,
          },
        },
      },
    }),
    prismaQuery.memory.count({
      where: {
        identityId: identity.id,
        deletedAt: null,
        ...(input.category ? { category: input.category as never } : {}),
      },
    }),
  ]);

  const memories: ListedMemory[] = rows.map((row) => ({
    memoryId: row.id,
    content: row.content,
    category: row.category,
    tags: row.tags,
