import { getOkxWalletPortfolio } from '../lib/okx/dexPrices.ts';
import { PUBLIC_BASE_URL } from '../config/main-config.ts';
import { queryTopK } from './memoryQuery.ts';
import { writeOne } from './memoryWriter.ts';
import { seedWalletMemories } from './walletSeed.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { getOrCreateIdentity } from './identity.ts';

// -----------------------------------------------------------------------------
// Finance Brief — one-call Finance Copilot packet.
// Seeds wallet history, writes a daily OKX portfolio snapshot fact, then recalls
// financial context. Matches the marketplace "Finance Brief" listing claim.
// -----------------------------------------------------------------------------

export interface FinanceBriefResult {
  identity: string;
  financialSeedSummary: string;
  portfolio: {
    totalUsdValue: string;
    topTokens: Array<{ symbol: string; balance: string; usdValue: string }>;
    memoryId: string | null;
    portfolioUrl: string;
    fetchedAt: string;
  };
  // Finance Copilot v2 additions — PnL delta vs the last portfolio snapshot.
  pnl: {
    previousUsdValue: string | null;
    deltaUsdValue: string;
    deltaPercent: string;
    direction: 'up' | 'down' | 'flat' | 'first-snapshot';
    since: string | null;
    deltaMemoryId: string | null;
    topMovers: Array<{ symbol: string; deltaUsd: string; direction: 'up' | 'down' | 'new' | 'closed' }>;
  };
  recalledMemories: number;
  topFinancialContext: Array<{
    memoryId: string;
    content: string;
    relevance: number;
    category: string;
    tags: string[];
  }>;
  portfolioHighlight: string | null;
  nextPrompts: string[];
  portraitUrl: string;
}

// Look up the most recent portfolio memory (tag `portfolio`) to compute PnL.
// Returns null when this is the first ever finance_brief for this identity.
const fetchPreviousPortfolio = async (
  identityId: string,
  excludeToday: string
): Promise<{ totalUsdValue: string; createdAt: Date; tokens: Array<{ symbol: string; usdValue: string }> } | null> => {
  const row = await prismaQuery.memory.findFirst({
    where: {
      identityId,
      deletedAt: null,
      category: 'fact',
      tags: { has: 'portfolio' },
      NOT: { metadata: { path: ['day'], equals: excludeToday } },
    },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true, createdAt: true },
  });
  if (!row) return null;
  const meta = row.metadata as Record<string, unknown> | null;
  const totalUsdValue =
    typeof meta?.totalUsdValue === 'string' ? meta.totalUsdValue : '0';
  const rawTokens = Array.isArray(meta?.tokens) ? (meta.tokens as Array<Record<string, unknown>>) : [];
  const tokens = rawTokens.map((t) => ({
    symbol: typeof t.symbol === 'string' ? t.symbol : '',
    usdValue: typeof t.usdValue === 'string' ? t.usdValue : '0',
  }));
  return { totalUsdValue, createdAt: row.createdAt, tokens };
};

const computeTopMovers = (
  current: Array<{ symbol: string; usdValue: string }>,
  previous: Array<{ symbol: string; usdValue: string }>
): Array<{ symbol: string; deltaUsd: string; direction: 'up' | 'down' | 'new' | 'closed' }> => {
  const prevMap = new Map(previous.map((t) => [t.symbol, parseFloat(t.usdValue || '0')]));
  const curMap = new Map(current.map((t) => [t.symbol, parseFloat(t.usdValue || '0')]));
  const symbols = new Set<string>([...prevMap.keys(), ...curMap.keys()]);

  const movers: Array<{ symbol: string; deltaUsd: string; direction: 'up' | 'down' | 'new' | 'closed' }> = [];
  for (const sym of symbols) {
    if (!sym) continue;
    const prev = prevMap.get(sym) ?? 0;
    const cur = curMap.get(sym) ?? 0;
    const delta = cur - prev;
    if (Math.abs(delta) < 0.01) continue;
    let direction: 'up' | 'down' | 'new' | 'closed';
    if (prev === 0) direction = 'new';
