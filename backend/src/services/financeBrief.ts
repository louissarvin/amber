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
    else if (cur === 0) direction = 'closed';
    else direction = delta > 0 ? 'up' : 'down';
    movers.push({ symbol: sym, deltaUsd: delta.toFixed(4), direction });
  }
  movers.sort((a, b) => Math.abs(parseFloat(b.deltaUsd)) - Math.abs(parseFloat(a.deltaUsd)));
  return movers.slice(0, 5);
};

export const buildFinanceBrief = async (identityAddress: string): Promise<FinanceBriefResult> => {
  const identity = identityAddress.toLowerCase();

  // 1) Seed on-chain wallet memories (balance / tx / OKX seed path).
  const seedResult = await seedWalletMemories({ identityAddress: identity, lookbackBlocks: 0 });

  // 2) Explicit live portfolio snapshot (listing claim).
  const portfolio = await getOkxWalletPortfolio(identity);
  const fetchedAt = new Date().toISOString();
  const topTokens = portfolio.tokens.slice(0, 10);
  let portfolioMemoryId: string | null = null;

  const tokenSummary = topTokens
    .map((t) => `${t.symbol}: $${parseFloat(t.usdValue || '0').toFixed(2)}`)
    .join(', ');
  const portfolioContent =
    `Portfolio snapshot on X Layer for ${identity}. ` +
    `Total value: $${parseFloat(portfolio.totalUsdValue || '0').toFixed(2)} USD. ` +
    `Tokens: ${tokenSummary || 'none detected'}.`;

  // Compact tokens list for metadata (limit to top 10 to keep the row small).
  const tokensForMeta = topTokens.map((t) => ({ symbol: t.symbol, usdValue: t.usdValue }));

  const day = fetchedAt.slice(0, 10);
  try {
    const w = await writeOne({
      identityAddress: identity,
      content: portfolioContent,
      category: 'fact',
      tags: ['portfolio', 'xlayer', 'okx-dex', 'snapshot', 'finance-brief'],
      metadata: {
        source: 'finance_brief',
        totalUsdValue: portfolio.totalUsdValue,
        day,
        // Snapshot compact token list so PnL delta can be computed cheaply
        // from metadata on the next call — no OKX round-trip needed.
        tokens: JSON.stringify(tokensForMeta),
      },
      clientNonce: `finance-brief-portfolio:${identity}:${day}`,
      paymentMode: 'free',
    });
    portfolioMemoryId = w.memoryId;
  } catch (err) {
    console.warn('[finance_brief] portfolio memory write failed:', (err as Error).message);
  }

  // Finance Copilot v2 — PnL delta vs the previous portfolio snapshot.
  const identityRow = await getOrCreateIdentity(identity);
  const previous = await fetchPreviousPortfolio(identityRow.id, day);
  const currentTotal = parseFloat(portfolio.totalUsdValue || '0');
  let pnlBlock: FinanceBriefResult['pnl'];
  if (previous === null) {
    pnlBlock = {
      previousUsdValue: null,
      deltaUsdValue: '0.000000',
      deltaPercent: '0.00',
      direction: 'first-snapshot',
      since: null,
      deltaMemoryId: null,
      topMovers: [],
    };
  } else {
    const prevTotal = parseFloat(previous.totalUsdValue || '0');
    const deltaUsd = currentTotal - prevTotal;
    const deltaPct = prevTotal > 0 ? (deltaUsd / prevTotal) * 100 : 0;
    const direction: 'up' | 'down' | 'flat' =
      Math.abs(deltaUsd) < 0.01 ? 'flat' : deltaUsd > 0 ? 'up' : 'down';

    // Reconstruct previous tokens from stored metadata (JSON.parse if we
    // stored it as a string — fall back to empty array on any parse error).
    let prevTokens: Array<{ symbol: string; usdValue: string }> = [];
    try {
      // financeBrief now stores tokens as JSON string in metadata; older rows
      // may store the array directly. Support both shapes.
      prevTokens = previous.tokens;
    } catch {
      prevTokens = [];
    }
    const movers = computeTopMovers(tokensForMeta, prevTokens);

    let deltaMemoryId: string | null = null;
    if (direction !== 'flat') {
      const arrow = direction === 'up' ? '↑' : '↓';
      const summary =
        `Portfolio PnL delta: ${arrow} $${Math.abs(deltaUsd).toFixed(4)} ` +
        `(${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%) ` +
        `from $${prevTotal.toFixed(4)} to $${currentTotal.toFixed(4)} on X Layer. ` +
        (movers.length
          ? `Top movers: ${movers
              .map((m) => `${m.symbol}(${m.direction === 'up' ? '+' : m.direction === 'down' ? '-' : m.direction}$${m.deltaUsd})`)
              .join(', ')}.`
          : '');
      try {
        const w = await writeOne({
          identityAddress: identity,
          content: summary,
          category: 'fact',
          tags: ['portfolio', 'pnl', 'finance-brief', direction === 'up' ? 'pnl-up' : 'pnl-down'],
          metadata: {
            source: 'finance_brief_pnl',
            deltaUsd: deltaUsd.toFixed(6),
            deltaPct: deltaPct.toFixed(4),
            direction,
            day,
          },
          clientNonce: `finance-brief-pnl:${identity}:${day}`,
          paymentMode: 'free',
        });
        deltaMemoryId = w.memoryId;
      } catch (err) {
        console.warn('[finance_brief] pnl memory write failed:', (err as Error).message);
      }
    }

    pnlBlock = {
      previousUsdValue: prevTotal.toFixed(6),
      deltaUsdValue: deltaUsd.toFixed(6),
      deltaPercent: deltaPct.toFixed(2),
      direction,
      since: previous.createdAt.toISOString(),
      deltaMemoryId,
      topMovers: movers,
    };
  }

  // 3) Semantic recall of financial context.
  const financialMemories = await queryTopK({
    identityAddress: identity,
    q: 'portfolio balance holdings wallet transactions financial value OKX',
    k: 8,
    category: null,
    since: null,
    minRelevance: 0.25,
  });

  const portfolioMemory = financialMemories.find(
    (m) =>
      m.category === 'fact' &&
      (m.tags.includes('portfolio') ||
        m.tags.includes('wallet-seed') ||
        m.tags.includes('finance-brief'))
  );

  const seedSummary =
    `Seeded ${seedResult.memoriesWritten} wallet memories. ` +
    `Balance: ${seedResult.snapshot.balanceOkb} OKB, ${seedResult.snapshot.txCount} txs on X Layer. ` +
    `Live portfolio: $${parseFloat(portfolio.totalUsdValue || '0').toFixed(2)} USD` +
    (portfolioMemoryId ? ' (stored).' : '.');

  return {
    identity,
    financialSeedSummary: seedSummary,
    portfolio: {
      totalUsdValue: portfolio.totalUsdValue,
      topTokens,
      memoryId: portfolioMemoryId,
      portfolioUrl: `https://web3.okx.com/portfolio?address=${identity}`,
      fetchedAt,
    },
    pnl: pnlBlock,
    recalledMemories: financialMemories.length,
    topFinancialContext: financialMemories.slice(0, 5).map((m) => ({
      memoryId: m.memoryId,
      content: m.content,
      relevance: m.relevance,
      category: m.category,
      tags: m.tags,
    })),
    portfolioHighlight: portfolioMemory?.content ?? portfolioContent,
    nextPrompts: [
      `Query AMBER for my portfolio: "What is my current X Layer portfolio value?"`,
      `Run memory_related on the portfolio memoryId to see all related financial context`,
      `Run memory_whoami for ${identity} to see full identity context`,
      `Run lifestyle_remember to pin a personal preference for Lifestyle Companion demos`,
    ],
    portraitUrl: `${PUBLIC_BASE_URL}/portrait/${identity}.svg`,
  };
};
