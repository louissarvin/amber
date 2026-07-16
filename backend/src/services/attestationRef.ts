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
  txHash: null,
  merkleRoot: null,
  status: 'pending',
  attestedAt: null,
});

export const attestationRefFromMemoryId = async (
  memoryId: string
): Promise<AttestationRef> => {
  const memory = await prismaQuery.memory.findUnique({
    where: { id: memoryId },
    select: {
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

  if (!memory?.attestation) return pendingAttestationRef();

  const a = memory.attestation;
  return {
    chainId: a.chainId,
    txHash: a.txHash,
    merkleRoot: a.merkleRoot ? `0x${Buffer.from(a.merkleRoot).toString('hex')}` : null,
    status: a.status,
    attestedAt: a.attestedAt ? a.attestedAt.toISOString() : null,
  };
};
