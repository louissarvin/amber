import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { collectAmberStats } from '../services/metrics.ts';
import { redis } from '../lib/redis.ts';
import { PUBLIC_BASE_URL } from '../config/main-config.ts';
import { AmberErrorCodes, handleError } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// Social Buzz surface — public, cached, shareable social content.
//
// GET /social/card — JSON with preformatted tweet/post body + stats snapshot
// GET /social/badge.svg — live SVG badge for GitHub READMEs / embeds
//
// Both are free, rate-limit exempt (under the global 200/min cap), cached in
// Redis for 120 seconds. Targeted at the Social Buzz hackathon track.
// -----------------------------------------------------------------------------

const CARD_CACHE_KEY = 'social:card:v1';
const CARD_CACHE_TTL = 120; // 2 minutes
const BADGE_CACHE_TTL = 120;
const BADGE_CACHE_PREFIX = 'social:badge:v1';

// Build the social card (tweet + og metadata).
const buildCard = async (): Promise<object> => {
  const s = await collectAmberStats(24);

  const totalMem = s.memories.totalActive.toLocaleString();
  const writeCount = s.memories.writtenInWindow.toLocaleString();
  const identityCount = s.identities.activeInWindow.toLocaleString();
  const attested = s.memories.attestedInWindow.toLocaleString();
  // Honest headline: settled on-chain USD₮0 only (verifiable on X Layer).
  const usdtPaid = s.payments.settledPaidUsdtInWindow;
  const top =
    s.topCategories.length > 0
      ? s.topCategories
          .slice(0, 3)
          .map((c) => `#${c.category}`)
          .join(' ')
      : '#memory #agent #identity';

  const tweet = [
    `AMBER — the reputation memory layer for @OKX AI on @OKX_XLayer`,
    ``,
    `Every ERC-8004 identity gets a live 0-100 Reputation Score computed from memories, attestations, payments, and coverage across all 5 OKX AI verticals.`,
    `Works in Claude Code · Codex · OpenClaw · Hermes.`,
    ``,
    `24h: ${writeCount} memories · ${identityCount} identities · ${attested} attested · ${usdtPaid} USDT via #x402`,
    ``,
    `Try: ${PUBLIC_BASE_URL}/identity/reputation/0x<your-address>`,
    `${top} #OKXAI`,
  ].join('\n');

  const xPost90s = [
    `90s demo script for #OKXAI:`,
    `1) Claude Code: memory_write ("I build on X Layer") — free tier`,
    `2) Codex or Hermes: memory_query same identity — recall works cross-client`,
    `3) OpenClaw: finance_brief — seeds wallet + 24h PnL delta + top movers`,
    `4) Any client: memory_whoami — persistent identity context, everywhere`,
    `5) Open the portrait SVG constellation — Artistic Excellence proof`,
    `6) Optional: seal_generate (0.05 USDT paid) — Revenue Rocket evidence`,
  ].join('\n');

  return {
    tweet,
    xPost90s,
    hashtags: ['#OKXAI', '#x402', '#OKX_XLayer'],
    headline: `${totalMem} total memories · ${writeCount} written today`,
    stats: {
      totalMemories: s.memories.totalActive,
      memoriesIn24h: s.memories.writtenInWindow,
      activeIdentities: s.identities.activeInWindow,
      attestedBatches: s.memories.attestedInWindow,
      totalPaidUsdt: usdtPaid,
      topCategories: s.topCategories.slice(0, 5),
    },
    urls: {
      api: PUBLIC_BASE_URL,
      docs: `${PUBLIC_BASE_URL}/docs`,
      report: `${PUBLIC_BASE_URL}/report/daily`,
      revenue: `${PUBLIC_BASE_URL}/report/revenue`,
      publicStats: `${PUBLIC_BASE_URL}/public/stats`,
      leaderboard: `${PUBLIC_BASE_URL}/public/leaderboard`,
      skill: `${PUBLIC_BASE_URL}/skills/amber/SKILL.md`,
      judging: `${PUBLIC_BASE_URL}/report/judging`,
      onboarding: `${PUBLIC_BASE_URL}/.well-known/amber`,
      badge: `${PUBLIC_BASE_URL}/social/badge.svg`,
    },
    generatedAt: s.generatedAt,
  };
};

// Build a compact SVG status badge (shields.io style).
const buildBadge = async (): Promise<string> => {
  const label = 'memories';
  let value = '…';
  let color = '#E4A853';

  try {
    const s = await collectAmberStats(1); // 1h window for recency
    const n = s.memories.totalActive;
    value = n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}K`
      : String(n);
    color = '#E4A853';
  } catch {
    color = '#888888';
    value = 'N/A';
  }

  const labelW = 72;
  const valueText = `${value} ${label}`;
  const valueW = Math.max(80, valueText.length * 6 + 16);
  const totalW = labelW + valueW;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" viewBox="0 0 ${totalW} 20">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalW}" height="20" rx="3"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="${color}"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
    <text x="${labelW / 2 * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelW - 10) * 10}" lengthAdjust="spacing">AMBER</text>
    <text x="${labelW / 2 * 10}" y="140" transform="scale(.1)" textLength="${(labelW - 10) * 10}" lengthAdjust="spacing">AMBER</text>
    <text x="${(labelW + valueW / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueW - 10) * 10}" lengthAdjust="spacing">${valueText}</text>
    <text x="${(labelW + valueW / 2) * 10}" y="140" transform="scale(.1)" textLength="${(valueW - 10) * 10}" lengthAdjust="spacing">${valueText}</text>
  </g>
</svg>`;
};

const handleCard = async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
  try {
    const cached = await redis.get(CARD_CACHE_KEY);
    if (cached) {
      reply.header('X-Amber-Cache', 'HIT');
      return reply.code(200).send({ success: true, error: null, data: JSON.parse(cached) });
    }
  } catch {
    /* non-fatal */
  }

  try {
    const card = await buildCard();
    redis
      .set(CARD_CACHE_KEY, JSON.stringify(card), 'EX', CARD_CACHE_TTL)
      .catch(() => undefined);
    reply.header('X-Amber-Cache', 'MISS');
    return reply.code(200).send({ success: true, error: null, data: card });
  } catch (err) {
    return handleError(reply, 500, 'social card generation failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleBadge = async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
  try {
    const cached = await redis.get(BADGE_CACHE_PREFIX);
    if (cached) {
      return reply
        .code(200)
        .header('Content-Type', 'image/svg+xml; charset=utf-8')
        .header('Cache-Control', `public, max-age=${BADGE_CACHE_TTL}`)
        .send(cached);
    }
  } catch {
    /* non-fatal */
  }

  try {
    const badge = await buildBadge();
    redis.set(BADGE_CACHE_PREFIX, badge, 'EX', BADGE_CACHE_TTL).catch(() => undefined);
    return reply
      .code(200)
      .header('Content-Type', 'image/svg+xml; charset=utf-8')
      .header('Cache-Control', `public, max-age=${BADGE_CACHE_TTL}`)
      .send(badge);
  } catch (err) {
    return handleError(reply, 500, 'badge generation failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

export const socialRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get('/card', handleCard);
  app.get('/badge.svg', handleBadge);
  done();
};
