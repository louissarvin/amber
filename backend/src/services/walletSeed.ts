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

  const provider = xlayerProvider();
  const [balance, txCount, code, latest] = await Promise.all([
    provider.getBalance(address),
    provider.getTransactionCount(address),
    provider.getCode(address),
    provider.getBlockNumber(),
  ]);

  const isContract = code !== '0x' && code !== '0x0';
  const balanceOkb = formatEther(balance);

  const items: Array<{
    content: string;
    category: string;
    tags: string[];
    metadata: Record<string, string | number | boolean>;
    clientNonce: string | null;
  }> = [
    {
      content: `On X Layer, this identity holds approximately ${balanceOkb} OKB native balance as of the seed snapshot.`,
      category: 'fact',
      tags: ['wallet-seed', 'balance'],
      metadata: { source: 'xlayer', kind: 'balance' },
      clientNonce: `wallet-seed:balance:${address}:${latest}`,
    },
    {
      content: `This identity has sent ${txCount} transactions on X Layer (nonce/txCount) at seed time.`,
      category: 'fact',
      tags: ['wallet-seed', 'activity'],
      metadata: { source: 'xlayer', kind: 'txCount', txCount },
      clientNonce: `wallet-seed:txCount:${address}:${txCount}`,
    },
    {
      content: isContract
        ? 'This address is a contract on X Layer (bytecode present).'
        : 'This address is an EOA on X Layer (no contract bytecode).',
      category: 'system',
      tags: ['wallet-seed', 'account-type'],
      metadata: { source: 'xlayer', kind: 'accountType', isContract },
      clientNonce: `wallet-seed:type:${address}:${isContract ? 'contract' : 'eoa'}`,
    },
  ];

  let recentTxsFound = 0;
  if (lookback > 0) {
    const deadline = Date.now() + BLOCK_SCAN_BUDGET_MS;
    const fromBlock = Math.max(0, latest - lookback + 1);
    for (let bn = latest; bn >= fromBlock && recentTxsFound < 5; bn -= 1) {
      if (Date.now() > deadline) break;
      try {
        const block = await withTimeout(provider.getBlock(bn, true), BLOCK_TIMEOUT_MS);
        if (!block?.prefetchedTransactions?.length) continue;
        for (const tx of block.prefetchedTransactions) {
          const from = tx.from?.toLowerCase();
          const to = tx.to?.toLowerCase();
          if (from !== address && to !== address) continue;
          recentTxsFound += 1;
          const direction = from === address ? 'sent' : 'received';
          const peer = from === address ? to ?? 'contract-create' : from ?? 'unknown';
          const value = formatEther(tx.value ?? 0n);
          items.push({
            content: `Recent X Layer activity: ${direction} ${value} OKB involving ${peer} in block ${bn} (tx ${tx.hash.slice(0, 10)}…).`,
            category: 'event',
            tags: ['wallet-seed', 'tx', direction],
            metadata: {
              source: 'xlayer',
              kind: 'tx',
              hash: tx.hash,
              blockNumber: bn,
            },
            clientNonce: `wallet-seed:tx:${tx.hash}`,
          });
          if (recentTxsFound >= 5) break;
        }
      } catch {
        // Skip unavailable / timed-out blocks; seed still returns balance facts.
      }
    }
  }

  // OKX DEX portfolio snapshot — enriches memories with real financial state.
  // Any failure here must not break the seed path: we swallow and skip.
  try {
    const portfolio = await getOkxWalletPortfolio(address);
    const totalNumeric = Number(portfolio.totalUsdValue);
    if (Number.isFinite(totalNumeric) && totalNumeric > 0 && portfolio.tokens.length > 0) {
      const holdingsSummary = portfolio.tokens
        .slice(0, 5)
        .map((t) => `${t.symbol} $${t.usdValue}`)
        .join(', ');
      items.push({
        content: `Portfolio snapshot for ${address}: total value $${portfolio.totalUsdValue}. Holdings: ${holdingsSummary}.`,
        category: 'fact',
        tags: ['portfolio', 'okx', 'defi'],
        metadata: {
          source: 'okx-dex-api',
          kind: 'portfolio',
          totalUsdValue: portfolio.totalUsdValue,
        },
        clientNonce: `wallet-seed:portfolio:${address}:${latest}`,
      });
    }
  } catch (err) {
    console.warn('[walletSeed] OKX portfolio fetch failed:', (err as Error).message);
  }

  const identity = await getOrCreateIdentity(address);
  const quota = await getOrCreateQuota(identity.id);
  const freeAvailable = Math.max(0, FREE_TIER_WRITES_PER_IDENTITY - quota.freeUsed);
  const freeItems = Math.min(freeAvailable, items.length);
  const paidItems = Math.max(0, items.length - freeItems);

  const bulk = await writeBulk(address, items, { paidItems, freeItems });
  const memoryIds = bulk.perItem
    .filter((e): e is { ok: true; memoryId: string; index: number } => e.ok)
    .map((e) => e.memoryId);

  return {
    memoriesWritten: memoryIds.length,
    memoryIds,
    snapshot: {
      balanceOkb,
      txCount,
      isContract,
      recentTxsFound,
      lookbackBlocks: lookback,
    },
  };
};
