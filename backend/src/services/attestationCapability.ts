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
