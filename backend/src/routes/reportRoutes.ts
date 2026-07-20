import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import { shortenAddress } from '../utils/miscUtils.ts';
import { AmberErrorCodes, handleBadInput, handleError } from '../utils/errorHandler.ts';
import {
  XLAYER_CHAIN_ID,
  PRICE_WRITE_ATOMIC,
  PRICE_QUERY_ATOMIC,
  PRICE_SEAL_ATOMIC,
} from '../config/main-config.ts';
import { collectAmberStats } from '../services/metrics.ts';
import { buildJudgingPack } from '../services/judgingPack.ts';
import { buildComparables } from '../services/comparables.ts';

// -----------------------------------------------------------------------------
// Daily Memory Report — public JSON feed for the marketing site + judges.
//
// Free, no payment, cached in Redis for 60 seconds. Never expose full 0x
// addresses; shortenAddress trims to 0xabc...def.
// -----------------------------------------------------------------------------

const DateQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
    .optional(),
});

const CACHE_TTL_SECONDS = 60;

const utcDayBounds = (dateStr: string): { start: Date; end: Date } => {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
};

const todayUtc = (): string => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const explorerTxUrl = (txHash: string): string => `https://oklink.com/x-layer/tx/${txHash}`;

const buildReport = async (date: string): Promise<object> => {
  const { start, end } = utcDayBounds(date);

  // Range: [start, end)
  const rangeWhere = { createdAt: { gte: start, lt: end } };
  const rangeWhereActive = { createdAt: { gte: start, lt: end }, deletedAt: null as Date | null };

  const [
    totalWrites,
    identityRows,
    totalAttestations,
    receiptStats,
    topIdentityRows,
    sampleAttestations,
  ] = await Promise.all([
    prismaQuery.memory.count({ where: rangeWhereActive }),
    prismaQuery.memory.findMany({
      where: rangeWhereActive,
      distinct: ['identityId'],
      select: { identityId: true },
    }),
    prismaQuery.attestation.count({
      where: { status: 'attested', attestedAt: { gte: start, lt: end } },
    }),
    prismaQuery.paymentReceipt.groupBy({
      by: ['mode'],
      where: rangeWhere,
      _count: { _all: true },
    }),
    prismaQuery.$queryRawUnsafe(
      `SELECT m."identityId", i.address, COUNT(*)::int AS memory_count
         FROM "Memory" m
         JOIN "Identity" i ON i.id = m."identityId"
        WHERE m."deletedAt" IS NULL
          AND m."createdAt" >= $1
          AND m."createdAt" < $2
        GROUP BY m."identityId", i.address
        ORDER BY memory_count DESC
        LIMIT 5`,
      start,
      end
    ) as Promise<Array<{ identityId: string; address: string; memory_count: number }>>,
    prismaQuery.attestation.findMany({
      where: { status: 'attested', attestedAt: { gte: start, lt: end } },
      orderBy: { attestedAt: 'desc' },
      take: 5,
      include: {
        identity: { select: { address: true } },
        _count: { select: { leaves: true } },
      },
    }),
  ]);

  const paidMode = receiptStats.find((r) => r.mode === 'exact')?._count._all ?? 0;
  const periodMode = receiptStats.find((r) => r.mode === 'period')?._count._all ?? 0;
  const freeMode = receiptStats.find((r) => r.mode === 'free')?._count._all ?? 0;

  // "Paid" = anything that resulted in an actual payment receipt row.
  // "Free" = writes served under the free tier (mode:free receipts optional).
  // If free-tier writes have no receipt row, back into the number by
  // subtracting paid from totalWrites.
  const totalPaidWrites = paidMode + periodMode;
  const totalFreeWrites = Math.max(0, totalWrites - totalPaidWrites) + freeMode;

  return {
    date,
    chainId: XLAYER_CHAIN_ID,
    totalWrites,
    totalIdentities: identityRows.length,
    totalAttestations,
    totalPaidWrites,
    totalFreeWrites,
    topIdentities: topIdentityRows.map((row) => ({
      address: shortenAddress(row.address),
      memoryCount: Number(row.memory_count),
    })),
    sampleAttestations: sampleAttestations.map((a) => ({
      txHash: a.txHash,
      root: `0x${Buffer.from(a.merkleRoot).toString('hex')}`,
      identity: shortenAddress(a.identity.address),
      memoryCount: a._count.leaves,
      xlayerExplorerUrl: a.txHash ? explorerTxUrl(a.txHash) : null,
      timestamp: a.attestedAt ? a.attestedAt.toISOString() : null,
    })),
    generatedAt: new Date().toISOString(),
  };
};

const handleDaily = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = DateQuerySchema.safeParse(request.query);
  if (!parsed.success) return handleBadInput(reply, parsed.error.errors[0]?.message ?? 'invalid date');
  const date = parsed.data.date ?? todayUtc();

  const cacheKey = `report:daily:${date}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Report-Cache', 'HIT');
      return reply.code(200).send({ success: true, error: null, data: JSON.parse(cached) });
    }
  } catch (err) {
    console.warn('[report] redis get failed, computing fresh:', (err as Error).message);
  }

  try {
    const report = await buildReport(date);
    // Best-effort cache — do not block on Redis failure.
    redis
      .set(cacheKey, JSON.stringify(report), 'EX', CACHE_TTL_SECONDS)
      .catch((err: Error) => {
        console.warn('[report] redis cache set failed:', err.message);
      });
    reply.header('X-Amber-Report-Cache', 'MISS');
    return reply.code(200).send({ success: true, error: null, data: report });
  } catch (err) {
    return handleError(reply, 500, 'report generation failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

// Revenue Rocket evidence — campaign-window order + USDT volume for judges.
const handleRevenue = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const cacheKey = 'report:revenue:v1';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Report-Cache', 'HIT');
      return reply.code(200).send({ success: true, error: null, data: JSON.parse(cached) });
    }
  } catch (err) {
    console.warn('[report] revenue cache get failed:', (err as Error).message);
  }

  try {
    const [stats24h, stats7d, settledTotals, authorizedTotals, paidWriteCount, paidQueryCount] =
      await Promise.all([
        collectAmberStats(24),
        collectAmberStats(24 * 7),
        // Settled on-chain (txHash present) grouped by mode — the HEADLINE figure.
        prismaQuery.paymentReceipt.groupBy({
          by: ['mode'],
          where: { txHash: { not: null } },
          _count: { _all: true },
          _sum: { amountAtomic: true },
        }),
        // All authorized receipts grouped by mode (settled + pending).
        prismaQuery.paymentReceipt.groupBy({
          by: ['mode'],
          _count: { _all: true },
          _sum: { amountAtomic: true },
        }),
        prismaQuery.paymentReceipt.count({ where: { endpoint: { contains: 'write' } } }),
        prismaQuery.paymentReceipt.count({ where: { endpoint: { contains: 'query' } } }),
      ]);

    const atomicToUsdt = (atomic: bigint | number | null | undefined): string => {
      const n = typeof atomic === 'bigint' ? Number(atomic) : Number(atomic ?? 0);
      return (n / 1_000_000).toFixed(6);
    };

    // Roll a groupBy result into a { byMode, totalOrders, totalUsdt } breakdown.
    const summariseByMode = (
      rows: Array<{ mode: string; _count: { _all: number }; _sum: { amountAtomic: bigint | null } }>
    ): { byMode: Array<{ mode: string; orders: number; usdt: string }>; totalOrders: number; totalUsdt: string } => {
      const byMode = rows.map((r) => ({
        mode: r.mode,
        orders: r._count._all,
        usdt: atomicToUsdt(r._sum.amountAtomic as unknown as bigint | null),
      }));
      return {
        byMode,
        totalOrders: byMode.reduce((acc, m) => acc + m.orders, 0),
        totalUsdt: byMode.reduce((acc, m) => acc + Number(m.usdt), 0).toFixed(6),
      };
    };

    const settled = summariseByMode(settledTotals);
    const authorized = summariseByMode(authorizedTotals);
    // Pending = authorized minus settled (per aggregate totals).
    const pendingOrders = authorized.totalOrders - settled.totalOrders;
    const pendingUsdt = (Number(authorized.totalUsdt) - Number(settled.totalUsdt)).toFixed(6);

    const data = {
      track: 'Revenue Rocket',
      chainId: XLAYER_CHAIN_ID,
      basis:
        'Headline `lifetime` totals count ON-CHAIN SETTLED USD₮0 only (txHash present, verifiable on X Layer). `authorized` includes verified EIP-3009 signatures not yet settled; `pending` is the difference awaiting the paymentSettler.',
      pricing: {
        writeUsdt: (PRICE_WRITE_ATOMIC / 1_000_000).toFixed(6),
        queryUsdt: (PRICE_QUERY_ATOMIC / 1_000_000).toFixed(6),
        freeTierWritesPerIdentity: 100,
      },
      lifetime: {
        // Headline = settled on-chain.
        totalOrders: settled.totalOrders,
        totalUsdtPaid: settled.totalUsdt,
        byMode: settled.byMode,
        paidWriteReceipts: paidWriteCount,
        paidQueryReceipts: paidQueryCount,
        authorized: {
          totalOrders: authorized.totalOrders,
          totalUsdtPaid: authorized.totalUsdt,
          byMode: authorized.byMode,
        },
        pending: {
          totalOrders: pendingOrders,
          totalUsdtPaid: pendingUsdt,
        },
      },
      window24h: {
        memoriesWritten: stats24h.memories.writtenInWindow,
        usdtPaid: stats24h.payments.settledPaidUsdtInWindow,
        usdtAuthorized: stats24h.payments.totalPaidUsdtInWindow,
        usdtPending: stats24h.payments.pendingPaidUsdtInWindow,
        activeIdentities: stats24h.identities.activeInWindow,
      },
      window7d: {
        memoriesWritten: stats7d.memories.writtenInWindow,
        usdtPaid: stats7d.payments.settledPaidUsdtInWindow,
        usdtAuthorized: stats7d.payments.totalPaidUsdtInWindow,
        usdtPending: stats7d.payments.pendingPaidUsdtInWindow,
        activeIdentities: stats7d.identities.activeInWindow,
      },
      howToLeavePositiveReview:
        'On OKX.AI agent page → leave feedback stars after a successful paid MCP call (memory_write / memory_query / seal_generate).',
      generatedAt: new Date().toISOString(),
    };

    redis
      .set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL_SECONDS)
      .catch((err: Error) => console.warn('[report] revenue cache set failed:', err.message));

    reply.header('X-Amber-Report-Cache', 'MISS');
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    return handleError(reply, 500, 'revenue report failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

// Judge-facing short human-readable revenue summary. Distilled from
// handleRevenue but formatted for at-a-glance evidence on the Google Form
// submission and X post preview cards. Cached in Redis for 60 seconds.
const handleSummary = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const cacheKey = 'report:revenue:summary:v1';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Report-Cache', 'HIT');
      return reply.code(200).send({ success: true, error: null, data: JSON.parse(cached) });
    }
  } catch (err) {
    console.warn('[report] summary cache get failed:', (err as Error).message);
  }

  try {
    const [stats7d, settledTotals, authorizedTotals] = await Promise.all([
      collectAmberStats(24 * 7),
      prismaQuery.paymentReceipt.groupBy({
        by: ['mode'],
        where: { txHash: { not: null } },
        _count: { _all: true },
        _sum: { amountAtomic: true },
      }),
      prismaQuery.paymentReceipt.groupBy({
        by: ['mode'],
        _count: { _all: true },
        _sum: { amountAtomic: true },
      }),
    ]);

    const atomicToUsdt = (atomic: bigint | number | null | undefined): string => {
      const n = typeof atomic === 'bigint' ? Number(atomic) : Number(atomic ?? 0);
      return (n / 1_000_000).toFixed(6);
    };

    const summariseByMode = (
      rows: Array<{ mode: string; _count: { _all: number }; _sum: { amountAtomic: bigint | null } }>
    ): { byMode: Array<{ mode: string; orders: number; usdt: string }>; totalOrders: number; totalUsdt: string } => {
      const byMode = rows.map((r) => ({
        mode: r.mode,
        orders: r._count._all,
        usdt: atomicToUsdt(r._sum.amountAtomic as unknown as bigint | null),
      }));
      return {
        byMode,
        totalOrders: byMode.reduce((acc, m) => acc + m.orders, 0),
        totalUsdt: byMode.reduce((acc, m) => acc + Number(m.usdt), 0).toFixed(6),
      };
    };

    const settled = summariseByMode(settledTotals);
    const authorized = summariseByMode(authorizedTotals);
    const pendingOrders = authorized.totalOrders - settled.totalOrders;
    const pendingUsdt = (Number(authorized.totalUsdt) - Number(settled.totalUsdt)).toFixed(6);

    const summaryLine = `${settled.totalOrders} orders settled on-chain · ${settled.totalUsdt} USD₮0 settled (verifiable on X Layer) · ${pendingOrders} orders / ${pendingUsdt} USD₮0 authorized pending settlement · ${stats7d.identities.activeInWindow} active identities in last 7 days`;

    const data = {
      headline: 'AMBER Revenue Evidence (OKX.AI Genesis Hackathon)',
      track: 'Revenue Rocket',
      basis:
        'Headline `lifetime` totals count ON-CHAIN SETTLED USD₮0 only (txHash present, verifiable on X Layer). `authorized` includes verified EIP-3009 signatures not yet settled; `pending` is the difference awaiting the paymentSettler.',
      summary: summaryLine,
      howToOrder:
        '1) Connect your OKX wallet to Claude Code. 2) Add AMBER MCP endpoint. 3) Run any paid tool (memory_write, memory_query, seal_generate). 4) Sign the EIP-3009 authorization in your wallet. 5) Leave a positive review on OKX.AI after success.',
      leaveReview: 'https://www.okx.ai/marketplace (search AMBER → Leave Review)',
      pricing: {
        writeUsdt: (PRICE_WRITE_ATOMIC / 1_000_000).toFixed(6),
        queryUsdt: (PRICE_QUERY_ATOMIC / 1_000_000).toFixed(6),
        sealUsdt: (PRICE_SEAL_ATOMIC / 1_000_000).toFixed(6),
      },
      lifetime: {
        totalOrders: settled.totalOrders,
        totalUsdtPaid: settled.totalUsdt,
        byMode: settled.byMode,
        authorized: {
          totalOrders: authorized.totalOrders,
          totalUsdtPaid: authorized.totalUsdt,
          byMode: authorized.byMode,
        },
        pending: {
          totalOrders: pendingOrders,
          totalUsdtPaid: pendingUsdt,
        },
      },
      window7d: {
        memoriesWritten: stats7d.memories.writtenInWindow,
        usdtPaid: stats7d.payments.settledPaidUsdtInWindow,
        usdtAuthorized: stats7d.payments.totalPaidUsdtInWindow,
        usdtPending: stats7d.payments.pendingPaidUsdtInWindow,
        activeIdentities: stats7d.identities.activeInWindow,
        paidReceipts: stats7d.payments.receiptCountInWindow,
        settledReceipts: stats7d.payments.settledOnChainInWindow,
      },
      generatedAt: new Date().toISOString(),
    };

    redis
      .set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL_SECONDS)
      .catch((err: Error) => console.warn('[report] summary cache set failed:', err.message));

    reply.header('X-Amber-Report-Cache', 'MISS');
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    return handleError(reply, 500, 'summary report failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

// Criteria-aligned evidence packet for Best Product / Software Utility judges.
const handleJudging = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const cacheKey = 'report:judging:v1';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Report-Cache', 'HIT');
      return reply.code(200).send({ success: true, error: null, data: JSON.parse(cached) });
    }
  } catch (err) {
    console.warn('[report] judging cache get failed:', (err as Error).message);
  }

  try {
    const data = await buildJudgingPack();
    redis
      .set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL_SECONDS)
      .catch((err: Error) => console.warn('[report] judging cache set failed:', err.message));

    reply.header('X-Amber-Report-Cache', 'MISS');
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    return handleError(reply, 500, 'judging report failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

// Top-payers leaderboard — anonymized ranking by lifetime USDT paid.
// Revenue Rocket evidence: shows judges the payer diversity and volume in one
// URL. Free, cached 60s in Redis. Addresses trimmed to 0xabc...def.
const handlePayers = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const cacheKey = 'report:payers:v1';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Report-Cache', 'HIT');
      return reply.code(200).send({ success: true, error: null, data: JSON.parse(cached) });
    }
  } catch (err) {
    console.warn('[report] payers cache get failed:', (err as Error).message);
  }

  try {
    // Group payment receipts by payer. Split each payer's volume into settled
    // on-chain (txHash present, verifiable on X Layer) vs authorized total.
    // FILTER (WHERE ...) is a standard SQL aggregate filter, not user input.
    const rows = (await prismaQuery.$queryRawUnsafe(
      `SELECT payer,
              COUNT(*)::int AS orders,
              COUNT(*) FILTER (WHERE "txHash" IS NOT NULL)::int AS settled_orders,
              SUM("amountAtomic")::bigint AS total_atomic,
              COALESCE(SUM("amountAtomic") FILTER (WHERE "txHash" IS NOT NULL), 0)::bigint AS settled_atomic,
              MAX("createdAt") AS last_paid_at
         FROM "PaymentReceipt"
        WHERE "amountAtomic" > 0
        GROUP BY payer
        ORDER BY total_atomic DESC
        LIMIT 25`
    )) as Array<{
      payer: string;
      orders: number;
      settled_orders: number;
      total_atomic: bigint;
      settled_atomic: bigint;
      last_paid_at: Date;
    }>;

    const atomicToUsdt = (atomic: bigint | number): string => {
      const n = typeof atomic === 'bigint' ? Number(atomic) : Number(atomic ?? 0);
      return (n / 1_000_000).toFixed(6);
    };

    const leaderboard = rows.map((r, idx) => ({
      rank: idx + 1,
      payer: shortenAddress(r.payer),
      orders: Number(r.orders),
      settledOrders: Number(r.settled_orders),
      // Headline = settled on-chain; authorized kept for payer-diversity signal.
      usdtPaid: atomicToUsdt(r.settled_atomic),
      usdtAuthorized: atomicToUsdt(r.total_atomic),
      lastPaidAt: r.last_paid_at ? r.last_paid_at.toISOString() : null,
    }));

    const totalSettledUsdt = leaderboard
      .reduce((acc, e) => acc + Number(e.usdtPaid), 0)
      .toFixed(6);
    const totalAuthorizedUsdt = leaderboard
      .reduce((acc, e) => acc + Number(e.usdtAuthorized), 0)
      .toFixed(6);
    const totalOrders = leaderboard.reduce((acc, e) => acc + e.orders, 0);
    const totalSettledOrders = leaderboard.reduce((acc, e) => acc + e.settledOrders, 0);

    const data = {
      track: 'Revenue Rocket',
      note: 'Top 25 lifetime payers on AMBER. Addresses anonymized. Ranked by authorized USD₮0 volume to show payer diversity; usdtPaid is the ON-CHAIN SETTLED figure (verifiable on X Layer), usdtAuthorized is the verified EIP-3009 total awaiting settlement.',
      basis:
        'usdtPaid = settled on-chain (txHash present). usdtAuthorized = verified EIP-3009 signatures, settled or pending.',
      totals: {
        payers: leaderboard.length,
        orders: totalOrders,
        settledOrders: totalSettledOrders,
        usdtPaid: totalSettledUsdt,
        usdtAuthorized: totalAuthorizedUsdt,
      },
      leaderboard,
      leaveReview: 'https://www.okx.ai/marketplace (search AMBER → Leave Review)',
      generatedAt: new Date().toISOString(),
    };

    redis
      .set(cacheKey, JSON.stringify(data), 'EX', 60)
      .catch((err: Error) => console.warn('[report] payers cache set failed:', err.message));

    reply.header('X-Amber-Report-Cache', 'MISS');
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    return handleError(reply, 500, 'payers report failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

// GET /report/comparables — AMBER vs Mem0/Zep/Letta head-to-head.
// Deterministic capability matrix + interoperability guides + ecosystem
// alignment. Every AMBER claim resolves to a live endpoint on this server.
const handleComparables = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const cacheKey = 'report:comparables:v1';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Report-Cache', 'HIT');
      return reply.code(200).send({ success: true, error: null, data: JSON.parse(cached) });
    }
  } catch (err) {
    console.warn('[report] comparables cache get failed:', (err as Error).message);
  }

  try {
    const data = buildComparables();
    redis
      .set(cacheKey, JSON.stringify(data), 'EX', 3600)
      .catch((err: Error) => console.warn('[report] comparables cache set failed:', err.message));
    reply.header('X-Amber-Report-Cache', 'MISS');
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    return handleError(reply, 500, 'comparables report failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

export const reportRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get('/daily', handleDaily);
  app.get('/revenue', handleRevenue);
  app.get('/summary', handleSummary);
  app.get('/judging', handleJudging);
  app.get('/payers', handlePayers);
  app.get('/comparables', handleComparables);
  done();
};
