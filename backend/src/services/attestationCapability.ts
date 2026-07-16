import { ethers } from 'ethers';
import { ATTESTATION_CONTRACT_ADDRESS, XLAYER_CHAIN_ID } from '../config/main-config.ts';
import { xlayerProvider } from '../lib/xlayer/rpc.ts';

// -----------------------------------------------------------------------------
// Honest attestation capability probe.
// Judges + buyers must never think writes are on-chain when the contract is a
// placeholder or unsigned. Cached for 60s.
// -----------------------------------------------------------------------------

export type AttestationCapability = {
  contractConfigured: boolean;
  contractHasCode: boolean;
  onChainLive: boolean;
  note: string;
};

let cached: { at: number; value: AttestationCapability } | null = null;
const CACHE_MS = 60_000;

const ZERO = '0x0000000000000000000000000000000000000000';

export const getAttestationCapability = async (): Promise<AttestationCapability> => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const addr = (ATTESTATION_CONTRACT_ADDRESS || '').toLowerCase();
  const contractConfigured = Boolean(addr) && addr !== ZERO && /^0x[0-9a-f]{40}$/.test(addr);

  let contractHasCode = false;
  if (contractConfigured) {
    try {
      const code = await xlayerProvider().getCode(ethers.getAddress(addr));
      contractHasCode = Boolean(code) && code !== '0x' && code !== '0x0';
    } catch {
      contractHasCode = false;
    }
  }

  const onChainLive = contractConfigured && contractHasCode;
  const note = onChainLive
    ? `Attestations settle to ${addr} on X Layer (chainId ${XLAYER_CHAIN_ID}).`
    : contractConfigured
      ? 'Attestation contract address is set but has no bytecode on X Layer — Merkle roots are stored off-chain until a real contract is deployed.'
      : 'No attestation contract configured — Merkle roots are computed and stored off-chain only (honest degrade).';

  const value: AttestationCapability = {
    contractConfigured,
    contractHasCode,
    onChainLive,
    note,
  };
  cached = { at: Date.now(), value };
  return value;
};
