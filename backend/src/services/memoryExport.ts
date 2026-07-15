import { Readable } from 'node:stream';
import { prismaQuery } from '../lib/prisma.ts';
import { pendingAttestationRef, type AttestationRef } from './attestationRef.ts';

// -----------------------------------------------------------------------------
// Memory export — NDJSON stream of the caller's memories.
//
// The endpoint is paid (PRICE_EXPORT_ATOMIC) so callers should be able to
// pull large-shape datasets without exhausting the server. We stream results
// in 100-row pages instead of loading the whole set into memory.
//
// Cursor semantics: the caller passes the `id` (cuid) of the last emitted
// row from a previous page. We fetch `limit + 1` rows so we can tell whether
// another page remains; the tail `{"__cursor":"<id>"}` line signals more.
// -----------------------------------------------------------------------------

export interface StreamMemoryExportInput {
  identityAddress: string;
  since: string | null;
  cursor: string | null;
  limit: number;
}

const PAGE_SIZE = 100;

const encodeAttestation = (
  attestation:
    | {
        chainId: number;
        txHash: string | null;
        merkleRoot: Uint8Array | null;
        status: 'pending' | 'submitted' | 'attested' | 'failed';
        attestedAt: Date | null;
      }
    | null
    | undefined
): AttestationRef => {
  if (!attestation) return pendingAttestationRef();
  return {
    chainId: attestation.chainId,
    txHash: attestation.txHash,
    merkleRoot: attestation.merkleRoot
      ? `0x${Buffer.from(attestation.merkleRoot).toString('hex')}`
      : null,
    status: attestation.status,
    attestedAt: attestation.attestedAt ? attestation.attestedAt.toISOString() : null,
  };
};

export const streamMemoryExport = async (
  input: StreamMemoryExportInput
): Promise<Readable> => {
  const identityAddressLower = input.identityAddress.toLowerCase();

  // Confirm identity exists BEFORE we start streaming so any DB lookup error
  // surfaces synchronously to the caller (returned as 500).
  const identity = await prismaQuery.identity.findUnique({
    where: { address: identityAddressLower },
    select: { id: true },
  });

  const identityId = identity?.id ?? null;
  const totalLimit = Math.max(1, Math.min(1000, input.limit));

  // Async generator implementation, wrapped in Readable.from() so Fastify
  // pipes it directly to the socket without buffering.
  async function* generate(): AsyncGenerator<string> {
    if (!identityId) {
      // No identity registered — return zero rows, no cursor.
      return;
    }

    let cursor: string | null = input.cursor;
    let emitted = 0;
    let moreRemaining = false;
    let lastEmittedId: string | null = null;

    const sinceDate = input.since ? new Date(input.since) : null;

    // Page in batches of PAGE_SIZE. Stop once we've emitted totalLimit rows
    // or run out of matches. Fetch PAGE_SIZE + 1 in the *last* page to know
    // whether more remain.
    outer: while (emitted < totalLimit) {
      const remaining = totalLimit - emitted;
      const pageTake = Math.min(PAGE_SIZE, remaining);
      const fetchTake = pageTake + 1;

      const rows = await prismaQuery.memory.findMany({
        where: {
          identityId,
          deletedAt: null,
          ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: fetchTake,
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
      });

      if (rows.length === 0) break;

      const consumable = rows.slice(0, pageTake);
      for (const row of consumable) {
        const line = {
          memoryId: row.id,
          content: row.content,
          category: row.category,
          tags: row.tags,
          metadata: row.metadata,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          attestation: encodeAttestation(row.attestation),
        };
        yield `${JSON.stringify(line)}\n`;
        lastEmittedId = row.id;
        emitted += 1;
        if (emitted >= totalLimit) {
          moreRemaining = rows.length > pageTake;
          break outer;
        }
      }

      // If we consumed less than fetchTake, no more pages remain.
      if (rows.length < fetchTake) {
        moreRemaining = false;
        break;
      }
      // Otherwise advance the cursor to the last consumed id and loop.
      cursor = lastEmittedId;
      moreRemaining = true;
    }

    if (moreRemaining && lastEmittedId) {
      yield `${JSON.stringify({ __cursor: lastEmittedId })}\n`;
    }
  }

  return Readable.from(generate());
};
