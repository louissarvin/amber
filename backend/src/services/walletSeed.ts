import { formatEther } from 'ethers';
import { xlayerProvider } from '../lib/xlayer/rpc.ts';
import { writeBulk } from './memoryWriter.ts';
import { getOrCreateIdentity } from './identity.ts';
import { FREE_TIER_WRITES_PER_IDENTITY } from '../config/main-config.ts';
import { getOrCreateQuota } from '../lib/quota/service.ts';
import { getOkxWalletPortfolio } from '../lib/okx/dexPrices.ts';

// -----------------------------------------------------------------------------
// Wallet → memory seed (doc 15 OKX-native integration #6).
// Reads public X Layer state for an identity, synthesises short event/system
// memories, and bulk-writes them so recall demos are never empty.
// No LLM. Deterministic string templates only.
//
// Recent-tx scanning is OPTIONAL (`lookbackBlocks`). Public RPCs often hang on
// `eth_getBlockByNumber(full)` for busy chains — we only scan when the caller
// asks, with a hard wall-clock budget so the request cannot block the event loop.
// -----------------------------------------------------------------------------

export interface WalletSeedInput {
  identityAddress: string;
  /** When set (>0), scan up to N recent blocks for txs involving the address. */
  lookbackBlocks?: number;
}

export interface WalletSeedResult {
  memoriesWritten: number;
  memoryIds: string[];
  snapshot: {
    balanceOkb: string;
    txCount: number;
    isContract: boolean;
    recentTxsFound: number;
    lookbackBlocks: number;
  };
}

const MAX_LOOKBACK = 16;
const BLOCK_SCAN_BUDGET_MS = 4_000;
const BLOCK_TIMEOUT_MS = 1_200;

const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const seedWalletMemories = async (
  input: WalletSeedInput
): Promise<WalletSeedResult> => {
  const address = input.identityAddress.toLowerCase();
  const lookback = Math.min(
    MAX_LOOKBACK,
    Math.max(0, input.lookbackBlocks ?? 0)
  );

