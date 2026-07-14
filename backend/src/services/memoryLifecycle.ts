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
    createdAt: row.createdAt.toISOString(),
    attestation: row.attestation
      ? {
          chainId: row.attestation.chainId,
          txHash: row.attestation.txHash,
          merkleRoot: row.attestation.merkleRoot
            ? `0x${Buffer.from(row.attestation.merkleRoot).toString('hex')}`
            : null,
          status: row.attestation.status,
          attestedAt: row.attestation.attestedAt
            ? row.attestation.attestedAt.toISOString()
            : null,
        }
      : pendingAttestationRef(),
  }));

  const nextCursor =
    rows.length === input.limit
      ? rows[rows.length - 1]!.createdAt.toISOString()
      : null;

  return { memories, nextCursor, total };
};

export interface SoftDeleteResult {
  memoryId: string;
  deletedAt: string;
}

export const softDeleteMemory = async (
  identityAddress: string,
  memoryId: string
): Promise<SoftDeleteResult> => {
  const identity = await getOrCreateIdentity(identityAddress);

  const existing = await prismaQuery.memory.findFirst({
    where: { id: memoryId, deletedAt: null },
    select: { id: true, identityId: true },
  });

  if (!existing) {
    const err = new Error('memory not found') as Error & { code: string };
    err.code = 'MEMORY_NOT_FOUND';
    throw err;
  }

  if (existing.identityId !== identity.id) {
    const err = new Error('identity does not own this memory') as Error & { code: string };
    err.code = 'MEMORY_FORBIDDEN';
    throw err;
  }

  const updated = await prismaQuery.memory.update({
    where: { id: memoryId },
    data: {
      deletedAt: new Date(),
      // Privacy-preserving soft delete: keep the row and attestation linkage
      // for forensic continuity, but remove user-readable content from reads,
      // exports, admin views, and accidental logs.
      content: '',
      tags: [],
      metadata: { deleted: true },
    },
    select: { id: true, deletedAt: true },
  });

  return {
    memoryId: updated.id,
    deletedAt: updated.deletedAt!.toISOString(),
  };
};

export { attestationRefFromMemoryId };

// -----------------------------------------------------------------------------
// getMemoryById — single-memory read used by GET /memory/:id (paid).
// Ownership is enforced by identity address (same pattern as softDeleteMemory).
// -----------------------------------------------------------------------------
export interface GetMemoryResult {
  memoryId: string;
  content: string;
  category: string;
  tags: string[];
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  attestation: AttestationRef;
}

export const getMemoryById = async (
  identityAddress: string,
  memoryId: string
): Promise<GetMemoryResult> => {
  const identity = await getOrCreateIdentity(identityAddress);

  const memory = await prismaQuery.memory.findFirst({
    where: { id: memoryId },
    include: {
      identity: { select: { address: true } },
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
  });

  // Deleted / never existed / content wiped -> treat as not found. This
  // avoids leaking existence of a soft-deleted memory to the paying caller.
  if (!memory || memory.deletedAt !== null || memory.content === null) {
    const err = new Error('memory not found') as Error & { code: string };
    err.code = 'MEMORY_NOT_FOUND';
    throw err;
  }

  if (memory.identity.address.toLowerCase() !== identityAddress.toLowerCase()) {
    // Additional check by id keeps parity with softDeleteMemory ownership.
    if (memory.identityId !== identity.id) {
      const err = new Error('identity does not own this memory') as Error & { code: string };
      err.code = 'MEMORY_FORBIDDEN';
      throw err;
    }
  }

  const attestation: AttestationRef = memory.attestation
    ? {
        chainId: memory.attestation.chainId,
        txHash: memory.attestation.txHash,
        merkleRoot: memory.attestation.merkleRoot
          ? `0x${Buffer.from(memory.attestation.merkleRoot).toString('hex')}`
          : null,
        status: memory.attestation.status,
        attestedAt: memory.attestation.attestedAt
          ? memory.attestation.attestedAt.toISOString()
          : null,
      }
    : pendingAttestationRef();

  return {
    memoryId: memory.id,
    content: memory.content,
    category: memory.category,
    tags: memory.tags,
    metadata: memory.metadata,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    attestation,
  };
};
