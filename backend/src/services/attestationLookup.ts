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

