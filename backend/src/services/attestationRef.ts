import { prismaQuery } from '../lib/prisma.ts';

// -----------------------------------------------------------------------------
// Shared attestation reference builder for REST + MCP responses.
// Writes enqueue async; callers that already have a memoryId can enrich the
// response with the latest on-chain status once the batcher lands.
// -----------------------------------------------------------------------------

export interface AttestationRef {
  chainId: number;
  txHash: string | null;
  merkleRoot: string | null;
  status: 'pending' | 'submitted' | 'attested' | 'failed';
  attestedAt: string | null;
}

export const pendingAttestationRef = (): AttestationRef => ({
  chainId: 196,
