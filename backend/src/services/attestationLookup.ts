import { prismaQuery } from '../lib/prisma.ts';
import { merkleProof } from '../lib/merkle.ts';
import { getAttestationCapability } from './attestationCapability.ts';

// Shared attestation read helper for REST + MCP tools.

const bytesToHex = (b: Uint8Array | Buffer): string => {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return `0x${buf.toString('hex')}`;
};

export interface MemoryAttestationView {
  memoryId: string;
  identity: string;
  attestation: {
    status: string;
    chainId: number;
    txHash: string | null;
    root: string | null;
    attestedAt: string | null;
    leafIndex: number | null;
    leaf: string | null;
    proof: string[] | null;
    explorerHint: string | null;
    onChainLive: boolean;
    settlementNote: string;
  };
}

export const getMemoryAttestationView = async (
  memoryId: string
): Promise<MemoryAttestationView | null> => {
  const capability = await getAttestationCapability();

  const memory = await prismaQuery.memory.findFirst({
    where: { id: memoryId },
    select: {
      id: true,
      deletedAt: true,
      attestationId: true,
      identity: { select: { address: true } },
    },
  });
  if (!memory || memory.deletedAt) return null;

  if (!memory.attestationId) {
    return {
      memoryId: memory.id,
      identity: memory.identity.address,
      attestation: {
        status: 'pending',
        chainId: 196,
        txHash: null,
        root: null,
        attestedAt: null,
        leafIndex: null,
        leaf: null,
        proof: null,
        explorerHint: null,
        onChainLive: capability.onChainLive,
        settlementNote: capability.note,
      },
    };
  }

  const attestation = await prismaQuery.attestation.findUnique({
    where: { id: memory.attestationId },
    include: { leaves: { orderBy: { position: 'asc' } } },
  });
  if (!attestation) return null;

  const orderedLeaves = attestation.leaves.map((l) => Buffer.from(l.leafHash));
  const target = attestation.leaves.find((l) => l.memoryId === memory.id);
  const proof = target ? merkleProof(orderedLeaves, target.position) : null;
  const root = bytesToHex(attestation.merkleRoot);
  const hasTx = Boolean(attestation.txHash);
  const confirmedOnChain =
    capability.onChainLive && hasTx && attestation.status === 'attested';

  return {
    memoryId: memory.id,
    identity: memory.identity.address,
    attestation: {
      status: attestation.status,
      chainId: attestation.chainId,
      txHash: attestation.txHash,
      root,
      attestedAt: attestation.attestedAt?.toISOString() ?? null,
      leafIndex: target?.position ?? null,
      leaf: proof?.leaf ?? null,
      proof: proof?.proof ?? null,
      explorerHint: attestation.txHash
        ? `https://www.oklink.com/x-layer/tx/${attestation.txHash}`
        : null,
      onChainLive: confirmedOnChain,
      settlementNote: confirmedOnChain
        ? capability.note
        : hasTx
          ? `${capability.note} Tx recorded but status=${attestation.status}.`
          : capability.note,
    },
  };
};
