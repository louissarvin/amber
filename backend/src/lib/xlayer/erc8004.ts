import { ethers } from 'ethers';
import { xlayerProvider } from './rpc.ts';
import { redis } from '../redis.ts';
import { ERC8004_REGISTRY_ADDRESS } from '../../config/main-config.ts';

// -----------------------------------------------------------------------------
// ERC-8004 identity registry (best-effort read-only)
//
// Per ADR-006: identity is keyed by agentId (ERC-721 tokenId), NOT by address.
// There is no `resolveByAddress`. Reverse lookup uses balanceOf +
// tokenOfOwnerByIndex + getAgentWallet(agentId) cross-check, capped at 5.
//
// This is best-effort — writes never block on resolution result unless
// REQUIRE_ERC8004_REGISTERED=true (that gate is enforced at the identity
// service layer, not here).
// -----------------------------------------------------------------------------

const REGISTRY_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function getAgentWallet(uint256 agentId) external view returns (address)',
];

const RESOLVE_CAP = 5;
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h

export interface Erc8004Resolution {
  agentId: string | null;
  reputation: number | null;
  resolvedAt: number; // unix seconds
}

let contractSingleton: ethers.Contract | null = null;

const registry = (): ethers.Contract => {
  if (contractSingleton) return contractSingleton;
  contractSingleton = new ethers.Contract(
    ERC8004_REGISTRY_ADDRESS,
    REGISTRY_ABI,
    xlayerProvider()
  );
  return contractSingleton;
};

export const resolveErc8004 = async (
  addressLower: string
): Promise<Erc8004Resolution> => {
  const cacheKey = `identity:${addressLower}`;

  try {
    const cached = await redis.hgetall(cacheKey);
    if (cached && cached.resolvedAt) {
      return {
        agentId: cached.agentId && cached.agentId !== '' ? cached.agentId : null,
        reputation:
          cached.reputation && cached.reputation !== '' ? Number(cached.reputation) : null,
        resolvedAt: Number(cached.resolvedAt),
      };
    }
  } catch (err) {
    console.warn('[erc8004] redis cache read failed:', (err as Error).message);
  }

  let agentId: string | null = null;
  try {
    const reg = registry();
    const rawBalance = (await reg.balanceOf(addressLower)) as bigint;
    const balance = Number(rawBalance);
    if (balance > 0) {
      const upto = Math.min(balance, RESOLVE_CAP);
      for (let i = 0; i < upto; i++) {
        const tokenId = (await reg.tokenOfOwnerByIndex(addressLower, i)) as bigint;
        const wallet = ((await reg.getAgentWallet(tokenId)) as string).toLowerCase();
        if (wallet === addressLower) {
          agentId = tokenId.toString();
          break;
        }
      }
    }
  } catch (err) {
    // Registry read failed — treat as not registered. Do NOT throw.
    console.warn('[erc8004] resolve failed for', addressLower, (err as Error).message);
  }

  const result: Erc8004Resolution = {
    agentId,
    reputation: null,
    resolvedAt: Math.floor(Date.now() / 1000),
  };

  redis
    .multi()
    .hset(cacheKey, {
      agentId: result.agentId ?? '',
      reputation: '',
      resolvedAt: String(result.resolvedAt),
    })
    .expire(cacheKey, CACHE_TTL_SECONDS)
    .exec()
    .catch((err: Error) => {
      console.warn('[erc8004] redis cache write failed:', err.message);
    });

  return result;
};
