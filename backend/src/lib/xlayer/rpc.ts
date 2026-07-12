import { ethers } from 'ethers';
import { XLAYER_CHAIN_ID, XLAYER_RPC } from '../../config/main-config.ts';

// -----------------------------------------------------------------------------
// XLayer read-only JsonRpcProvider
//
// Health check verifies chainId matches XLAYER_CHAIN_ID (defaults to 196).
// -----------------------------------------------------------------------------

let providerSingleton: ethers.JsonRpcProvider | null = null;

export const xlayerProvider = (): ethers.JsonRpcProvider => {
  if (providerSingleton) return providerSingleton;
  if (!XLAYER_RPC) {
    throw new Error('XLAYER_RPC is not configured');
  }
  providerSingleton = new ethers.JsonRpcProvider(XLAYER_RPC, {
    chainId: XLAYER_CHAIN_ID,
    name: 'xlayer',
  });
  return providerSingleton;
};

export const xlayerRpcHealthy = async (): Promise<boolean> => {
  try {
    const p = xlayerProvider();
    const net = await p.getNetwork();
    return Number(net.chainId) === XLAYER_CHAIN_ID;
  } catch (err) {
    console.warn('[xlayer.rpc] health check failed:', (err as Error).message);
    return false;
  }
};
