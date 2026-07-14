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
