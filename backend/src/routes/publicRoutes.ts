// GET /public/stats — at-a-glance revenue evidence for judges, X posts, and
// Revenue Rocket evidence links. No auth required. Cached 30s in Redis.
//
// Exposes: payment count, unique payers, USDT volume, active memories,
// identity count. This is the single URL you paste in the Google Form and
// X thread for Revenue Rocket + Social Buzz verification.

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import { AmberErrorCodes, handleError } from '../utils/errorHandler.ts';
import { XLAYER_CHAIN_ID, PUBLIC_BASE_URL } from '../config/main-config.ts';
import { MCP_TOOL_COUNT } from './mcpTransport.ts';

const CACHE_TTL_SECONDS = 30;

const handlePublicStats = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const cacheKey = 'public:stats:v1';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Cache', 'HIT');
      return reply.code(200).send(JSON.parse(cached));
    }
  } catch {
    // best-effort
  }

  try {
    // HEADLINE revenue = SETTLED ON-CHAIN only (txHash present == redeemed via
    // transferWithAuthorization on X Layer). Verified-but-unsettled authorizations
    // are surfaced separately under `pending` so nothing is hidden.
    const [
      settledCount,
      settledUsdtAgg,
      settledPayerRows,
      lastSettledRows,
      pendingCount,
      pendingUsdtAgg,
      pendingPayerRows,
      totalIdentities,
      activeMemories,
    ] = await Promise.all([
      // settled payment count
      prismaQuery.paymentReceipt.count({ where: { txHash: { not: null } } }),
      // settled USDT atomic sum
      prismaQuery.paymentReceipt.aggregate({
        where: { txHash: { not: null } },
        _sum: { amountAtomic: true },
      }),
      // distinct settled payers
      prismaQuery.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(DISTINCT payer)::bigint AS count FROM "PaymentReceipt" WHERE "txHash" IS NOT NULL`
      ),
      // most recent settled receipt (settledAt is the on-chain settlement time)
      prismaQuery.paymentReceipt.findMany({
        where: { txHash: { not: null } },
        orderBy: { settledAt: 'desc' },
        take: 1,
        select: { settledAt: true, createdAt: true, payer: true, amountAtomic: true, txHash: true },
      }),
      // pending = verified authorizations awaiting settlement (txHash null)
      prismaQuery.paymentReceipt.count({ where: { txHash: null } }),
      prismaQuery.paymentReceipt.aggregate({
        where: { txHash: null },
        _sum: { amountAtomic: true },
      }),
      prismaQuery.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(DISTINCT payer)::bigint AS count FROM "PaymentReceipt" WHERE "txHash" IS NULL`
      ),
      prismaQuery.identity.count(),
      prismaQuery.memory.count({ where: { deletedAt: null } }),
    ]);

    const toUsdt = (atomic: bigint | null | undefined): string =>
      (Number(atomic ?? BigInt(0)) / 1_000_000).toFixed(6);

    const settledPayers = Number((settledPayerRows[0]?.count as bigint | null) ?? BigInt(0));
    const settledUsdtVolume = toUsdt(settledUsdtAgg._sum.amountAtomic);
    const pendingPayers = Number((pendingPayerRows[0]?.count as bigint | null) ?? BigInt(0));
    const pendingUsdtVolume = toUsdt(pendingUsdtAgg._sum.amountAtomic);
    const lastReceipt = lastSettledRows[0] ?? null;

    const data = {
      amber: {
        chainId: XLAYER_CHAIN_ID,
        network: `eip155:${XLAYER_CHAIN_ID}`,
        chain: 'X Layer',
      },
      revenue: {
        // Headline = ON-CHAIN SETTLED USD₮0 only (verifiable on X Layer).
        basis:
          'Headline revenue counts on-chain SETTLED payments only (txHash present, redeemed via transferWithAuthorization on X Layer). `pending` = verified EIP-3009 authorizations awaiting settlement.',
        payments_count: settledCount,
        unique_payers: settledPayers,
        usdt_volume: settledUsdtVolume,
        last_payment: lastReceipt
          ? {
              payer: lastReceipt.payer.slice(0, 6) + '...' + lastReceipt.payer.slice(-4),
              usdt: (Number(lastReceipt.amountAtomic) / 1_000_000).toFixed(6),
              at: (lastReceipt.settledAt ?? lastReceipt.createdAt).toISOString(),
              txHash: lastReceipt.txHash,
              explorerUrl: lastReceipt.txHash
                ? `https://www.oklink.com/xlayer/tx/${lastReceipt.txHash}`
                : null,
            }
          : null,
        pending: {
          count: pendingCount,
          unique_payers: pendingPayers,
          usdt_volume: pendingUsdtVolume,
        },
      },
      usage: {
        identities: totalIdentities,
        active_memories: activeMemories,
      },
      links: {
        full_revenue_report: `${PUBLIC_BASE_URL}/report/revenue`,
        judging_pack: `${PUBLIC_BASE_URL}/report/judging`,
        recent_payments: `${PUBLIC_BASE_URL}/public/payments`,
        leave_review: 'https://www.okx.ai/marketplace',
        mcp_endpoint: `${PUBLIC_BASE_URL}/mcp`,
      },
      generatedAt: new Date().toISOString(),
    };

    redis
      .set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL_SECONDS)
      .catch(() => {/* best-effort */});

    reply.header('X-Amber-Cache', 'MISS');
    reply.header('Cache-Control', 'public, max-age=30');
    return reply.code(200).send(data);
  } catch (err) {
    return handleError(reply, 500, 'public stats failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

// GET /public/leaderboard — top identities by active memory count.
// Anonymized (last 4 chars of address shown). Social proof of real engagement.
// Cached 60s.

const handleLeaderboard = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const cacheKey = 'public:leaderboard:v1';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Cache', 'HIT');
      reply.header('Cache-Control', 'public, max-age=60');
      return reply.code(200).send(JSON.parse(cached));
    }
  } catch {
    // best-effort
  }

  try {
    const rows = await prismaQuery.$queryRawUnsafe<
      Array<{ address: string; memory_count: number; category_mix: string }>
    >(
      `SELECT i.address,
              COUNT(m.id)::int AS memory_count,
              array_agg(DISTINCT m.category ORDER BY m.category) AS category_mix
         FROM "Identity" i
         JOIN "Memory" m ON m."identityId" = i.id
        WHERE m."deletedAt" IS NULL
        GROUP BY i.address
        ORDER BY memory_count DESC
        LIMIT 10`
    );

    // pg driver returns Postgres enum arrays as a string like "{preference,fact,system}".
    // Parse either format so the field is always a string[].
    const parseCategoryMix = (raw: string | string[] | null): string[] => {
      if (!raw) return [];
      if (Array.isArray(raw)) return (raw as string[]).filter(Boolean).slice(0, 5);
      // Strip leading/trailing braces and split on comma.
      const s = String(raw).replace(/^\{|\}$/g, '').trim();
      if (!s) return [];
      return s.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 5);
    };

    const data = {
      leaderboard: rows.map((r, idx) => ({
        rank: idx + 1,
        identity: '0x' + r.address.slice(2, 4) + '...' + r.address.slice(-4),
        memoryCount: r.memory_count,
        categories: parseCategoryMix(r.category_mix as unknown as string | string[] | null),
      })),
      note: 'Addresses anonymized — first 2 + last 4 hex chars shown.',
      links: {
        stats: `${PUBLIC_BASE_URL}/public/stats`,
        revenue: `${PUBLIC_BASE_URL}/report/revenue`,
      },
      generatedAt: new Date().toISOString(),
    };

    redis
      .set(cacheKey, JSON.stringify(data), 'EX', 60)
      .catch(() => {/* best-effort */});

    reply.header('X-Amber-Cache', 'MISS');
    reply.header('Cache-Control', 'public, max-age=60');
    return reply.code(200).send(data);
  } catch (err) {
    return handleError(reply, 500, 'leaderboard failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

// GET /public/payments — anonymized recent x402 receipts for Revenue Rocket.
const handlePublicPayments = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const cacheKey = 'public:payments:v1';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Cache', 'HIT');
      reply.header('Cache-Control', 'public, max-age=30');
      return reply.code(200).send(JSON.parse(cached));
    }
  } catch {
    // best-effort
  }

  try {
    const rows = await prismaQuery.paymentReceipt.findMany({
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        createdAt: true,
        payer: true,
        amountAtomic: true,
        scheme: true,
        endpoint: true,
        txHash: true,
        mode: true,
      },
    });

    const data = {
      chainId: XLAYER_CHAIN_ID,
      network: `eip155:${XLAYER_CHAIN_ID}`,
      payments: rows.map((r) => ({
        at: r.createdAt.toISOString(),
        payer: `${r.payer.slice(0, 6)}...${r.payer.slice(-4)}`,
        usdt: (Number(r.amountAtomic) / 1_000_000).toFixed(6),
        scheme: r.scheme,
        mode: r.mode,
        endpoint: r.endpoint,
        settledOnChain: Boolean(r.txHash),
        explorerUrl: r.txHash
          ? `https://www.oklink.com/xlayer/tx/${r.txHash}`
          : null,
      })),
      note:
        'Payers anonymized. settledOnChain=true when paymentSettler redeemed EIP-3009 on X Layer.',
      links: {
        stats: `${PUBLIC_BASE_URL}/public/stats`,
        revenue: `${PUBLIC_BASE_URL}/report/revenue`,
        leaveReview: 'https://www.okx.ai/marketplace',
      },
      generatedAt: new Date().toISOString(),
    };

    redis.set(cacheKey, JSON.stringify(data), 'EX', 30).catch(() => undefined);
    reply.header('X-Amber-Cache', 'MISS');
    reply.header('Cache-Control', 'public, max-age=30');
    return reply.code(200).send(data);
  } catch (err) {
    return handleError(reply, 500, 'public payments failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

// GET /public/quickstart — judge-friendly guide: live stats + copy-paste commands.
// The single URL to share with judges who want to verify AMBER in 2 minutes.
const handleQuickstart = (
  _request: FastifyRequest,
  reply: FastifyReply
): FastifyReply => {
  const base = PUBLIC_BASE_URL.replace(/\/+$/, '');
  const mcp = `${base}/mcp`;

  return reply.code(200).header('Cache-Control', 'public, max-age=60').send({
    amber: 'Persistent memory-as-a-service for AI agents. Write once, recall anywhere.',
    chain: 'X Layer (eip155:196)',
    payment: 'OKX Agent Payments Protocol — x402 exact, USDT, EIP-3009',
    mcpEndpoint: mcp,
    mcpProtocol: '2025-06-18',
    mcpCapabilities: [`tools (${MCP_TOOL_COUNT})`, 'resources', 'prompts (6)', 'completion', 'logging', 'elicitation'],

    step1_connect: {
      title: 'Add AMBER to your MCP client',
      claudeCode: `claude mcp add amber --transport http ${mcp}`,
      cursor: `{ "mcpServers": { "amber": { "url": "${mcp}" } } }`,
      skill: `npx skills add amber --skill-path ${base}/skills/amber/SKILL.md`,
    },

    step2_try_free: {
      title: 'Try free tools (no wallet needed)',
      commands: [
        `finance_brief({ identity: "0x<your-wallet>" })  // Finance Copilot with 24h PnL`,
        `memory_demo_pack({ identity: "0x<your-wallet>" })  // one-call bootstrap`,
        `memory_whoami({ identity: "0x<your-wallet>" })  // who am I?`,
        `lifestyle_remember({ identity: "0x<your-wallet>", content: "I build agents on OKX.AI", kind: "preference" })`,
        `amber_judging_pack()  // full hackathon evidence packet`,
      ],
    },

    step2b_okx_ai_verticals: {
      title: 'One call per OKX AI vertical (memory_template)',
      note: 'Same tool, different vertical preset. Every downstream ASP in that category discovers the context via memory_query.',
      commands: [
        `memory_template({ identity: "0x<w>", vertical: "professional_asset", content: "Deck style: 12pt Inter, amber accents, one insight per slide" })`,
        `memory_template({ identity: "0x<w>", vertical: "resume", content: "Target: Senior Backend at DeFi teams. Strengths: TS, Rust, ZK, pgvector" })`,
        `memory_template({ identity: "0x<w>", vertical: "creative", content: "Brand palette: amber #E4A853, obsidian #1A1410, cream #FBF7ED" })`,
        `memory_template({ identity: "0x<w>", vertical: "software", content: "X Layer deploy notes: port 3700, pgvector 1024-dim, Redis 7" })`,
        `memory_template({ identity: "0x<w>", vertical: "prediction", content: "Risk: 5% per position, high-conviction YES on >70% edge" })`,
      ],
    },

    step3_try_paid: {
      title: 'Try paid tools (OKX wallet + USDT on X Layer)',
      commands: [
        `memory_query({ identity: "0x<wallet>", q: "portfolio" })  // 0.0005 USDT`,
        `seal_generate({ identity: "0x<wallet>", subject: "My first AMBER seal", decree: "I build on OKX.AI" })  // 0.05 USDT`,
      ],
      note: 'Sign EIP-3009 authorization in your OKX wallet. PAYMENT-RESPONSE header confirms settlement.',
    },

    evidence: {
      stats: `${base}/public/stats`,
      payments: `${base}/public/payments`,
      leaderboard: `${base}/public/leaderboard`,
      revenue: `${base}/report/revenue`,
      judging: `${base}/report/judging`,
      skill: `${base}/skills/amber/SKILL.md`,
      onboarding: `${base}/.well-known/amber`,
      social: `${base}/social/card`,
    },

    prizeTracksTargeted: [
      'Best Product ($20K)',
      'Revenue Rocket ($20K)',
      'Finance Copilot ($7.5K)',
      'Software Utility ($7.5K)',
      'Lifestyle Companion ($7.5K)',
      'Artistic Excellence ($7.5K)',
      'Social Buzz ($10K)',
      'Creative Genius ($20K)',
    ],

    leaveReview: 'https://www.okx.ai/marketplace — search AMBER → Leave Review after any paid call',
    generatedAt: new Date().toISOString(),
  });
};

// GET /public/showcase — top-3 usage stories by OKX-AI vertical coverage.
// Judges want proof of REAL adoption. We surface the 3 identities that best
// demonstrate breadth across the 5 OKX AI verticals (ranked by vertical
// coverage, then vertical-tagged depth, then overall memory count), with their
// verticals covered and portrait URL. Display addresses are truncated to
// 0xabc...def, while portrait/reputation links use the full public on-chain
// address so they resolve. Cached 5 minutes.
const handleShowcase = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const cacheKey = 'public:showcase:v1';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Cache', 'HIT');
      return reply.code(200).send(JSON.parse(cached));
    }
  } catch {
    /* best-effort */
  }

  try {
    // Top 3 identities that best DEMONSTRATE the 5 OKX AI verticals. Judges want
    // to see breadth-of-usage stories, so we rank by:
    //   1. vertical_coverage  — how many of the 5 OKX AI verticals are touched
    //   2. okx_ai_vertical_memories — depth of vertical-tagged usage
    //   3. memory_count       — overall engagement
    // All rows are real DB rows; nothing is fabricated. Identities that use more
    // verticals surface first so the top 3 actually tell the intended stories.
    const VERTICAL_TAG_ARRAY =
      `ARRAY['asset-creation','resume','creative','software','prediction-market']::text[]`;
    const rows = (await prismaQuery.$queryRawUnsafe(
      `SELECT i.address,
              COUNT(DISTINCT m.id)::int AS memory_count,
              COUNT(DISTINCT m.id) FILTER (
                WHERE m.tags && ${VERTICAL_TAG_ARRAY}
              )::int AS okx_ai_vertical_memories,
              v.verticals,
              COALESCE(array_length(v.verticals, 1), 0)::int AS vertical_coverage,
              MIN(m."createdAt") AS first_write,
              MAX(m."createdAt") AS last_write
         FROM "Identity" i
         JOIN "Memory" m ON m."identityId" = i.id
         LEFT JOIN LATERAL (
                SELECT ARRAY(
                  SELECT DISTINCT t
                    FROM "Memory" m2, unnest(m2.tags) AS t
                   WHERE m2."identityId" = i.id
                     AND m2."deletedAt" IS NULL
                     AND t = ANY (${VERTICAL_TAG_ARRAY})
                ) AS verticals
              ) v ON TRUE
        WHERE m."deletedAt" IS NULL
        GROUP BY i.id, i.address, v.verticals
        ORDER BY vertical_coverage DESC, okx_ai_vertical_memories DESC, memory_count DESC
        LIMIT 3`
    )) as Array<{
      address: string;
      memory_count: number;
      okx_ai_vertical_memories: number;
      verticals: string[] | null;
      vertical_coverage: number;
      first_write: Date | null;
      last_write: Date | null;
    }>;

    const anonymize = (addr: string): string =>
      `${addr.slice(0, 6)}...${addr.slice(-4)}`;

    const showcase = rows.map((r, idx) => ({
      rank: idx + 1,
      identity: anonymize(r.address),
      memoryCount: Number(r.memory_count),
      okxAiVerticalMemories: Number(r.okx_ai_vertical_memories),
      verticalsCovered: (r.verticals ?? []).filter((t) =>
        ['asset-creation', 'resume', 'creative', 'software', 'prediction-market'].includes(t)
      ),
      firstWriteAt: r.first_write ? r.first_write.toISOString() : null,
      lastWriteAt: r.last_write ? r.last_write.toISOString() : null,
      portraitUrl: `${PUBLIC_BASE_URL}/portrait/${r.address}.svg`,
    }));

    const data = {
      title: 'AMBER Showcase — top 3 identities by OKX-AI vertical coverage',
      note: 'Ranked by vertical coverage, then vertical-tagged depth, then memory count. Display addresses are truncated (first 6 + last 4); portrait and reputation links use the full public on-chain address. Verticals mapped to the 5 OKX AI ASP categories.',
      showcase,
      links: {
        stats: `${PUBLIC_BASE_URL}/public/stats`,
        leaderboard: `${PUBLIC_BASE_URL}/public/leaderboard`,
        payerLeaderboard: `${PUBLIC_BASE_URL}/report/payers`,
        reputationExample: showcase[0]
          ? `${PUBLIC_BASE_URL}/identity/reputation/${rows[0]?.address ?? ''}`
          : null,
      },
      generatedAt: new Date().toISOString(),
    };

    redis
      .set(cacheKey, JSON.stringify(data), 'EX', 300)
      .catch(() => undefined);

    reply.header('X-Amber-Cache', 'MISS');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.code(200).send(data);
  } catch (err) {
    return handleError(reply, 500, 'showcase failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

export const publicRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get('/stats', handlePublicStats);
  app.get('/leaderboard', handleLeaderboard);
  app.get('/payments', handlePublicPayments);
  app.get('/quickstart', handleQuickstart);
  app.get('/showcase', handleShowcase);
  done();
};
