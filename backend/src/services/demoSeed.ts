import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import { getOrCreateIdentity } from './identity.ts';
import {
  TEMPLATE_VERTICAL_KEYS,
  writeVerticalMemory,
} from './memoryTemplate.ts';

// -----------------------------------------------------------------------------
// Demo identity seeding.
//
// AMBER ships a stable, read-only demo identity so any judge/buyer can open
// /demo/live and see the product at its best in ~2 seconds. This module drives
// that identity through the REAL product write path (real OpenAI embeddings,
// real pgvector inserts, real reputation math) — no mock data, no hardcoded
// scores. Every memory below is a genuine, honest fact about AMBER's own
// architecture, brand, and operating profile, written via memory_template so it
// is indistinguishable from an organically-populated identity.
//
// Two modes:
//   - 'lazy'  : called from GET /demo/live when the identity is thin. Writes a
//               handful per vertical + pins so the endpoint is never empty.
//               Bounded + time-budgeted so it never blocks the response long.
//   - 'hero'  : called from scripts/seed-demo.ts. Writes the full set so the
//               identity reaches the "established" tier on the locally
//               satisfiable axes (persistence, breadth, deliberateness).
//
// Idempotency: writes use daily content-derived nonces (writeOne replays), a
// Redis NX lock prevents concurrent seeding, and a memory-count threshold skips
// re-seeding entirely once populated. Graceful degradation: every write is
// individually try/caught so an OpenAI/embeddings outage degrades the result
// instead of throwing — the demo endpoint must never 500.
// -----------------------------------------------------------------------------

// Stable demo identity. Valid 0x + 40 hex. Reads only for judges.
export const DEMO_IDENTITY = '0xdeadbeef000000000000000000000000deadbeef';

// Below this active-memory count, /demo/live will lazily top the identity up.
export const LAZY_SEED_THRESHOLD = 12;

// Per-vertical honest content bank. Each entry is a real fact about AMBER.
// Ordered most-important first so a small lazy seed still covers the story.
const CONTENT_BANK: Record<string, string[]> = {
  professional_asset: [
    'AMBER judging pack deck: 12pt Inter, amber #E4A853 accent on obsidian #1A1410, one insight per slide, cream #FBF7ED body text.',
    'Board-deck template rule: lead every slide with the metric, then the mechanism, then the ask. No decorative charts.',
    'AMBER one-pager layout: hero line, 3 proof links (stats, payments, reputation), single QR to the MCP endpoint.',
    'Report style: every claim in an AMBER report links to a live verifiable URL (/public/stats, /report/revenue).',
    'Pitch structure: problem (agents are stateless) → product (memory keyed on ERC-8004 identity) → proof (live revenue).',
    'Slide density cap: max 20 words of body copy per slide; the speaker notes carry the detail.',
    'Asset export presets: 1600x900 for decks, 1200x630 for OG cards, 1080x1080 for social.',
    'Color contrast rule for assets: amber accent only on obsidian; never amber-on-cream (fails AA contrast).',
    'Executive summary template: 5 bullets — what, who, traction, moat, ask — nothing else above the fold.',
    'Diagram convention: identity is always the primary key at the center; tools radiate outward.',
    'Table style: right-align numbers, monospace for hashes and addresses, truncate addresses to 6+4.',
    'Cover-slide formula: product name, one-line positioning, live proof URL, date. No stock imagery.',
    'Appendix rule: architecture and pricing tables go in the appendix, never the main flow.',
    'Chart palette: single amber series on dark grid; comparison series in muted cream.',
    'Quote-slide format: attributed pull-quote in Inter Light 28pt, amber quotation marks.',
    'Section divider: full-bleed obsidian, centered amber section number, cream label.',
    'KPI callout: number in 64pt amber, label in 14pt cream uppercase tracking-wide.',
    'Handout variant: same deck exported at 150 DPI with speaker notes appended per slide.',
  ],
  resume: [
    'Target roles: Senior Backend Engineer at DeFi and agent-infra teams. Core stack: TypeScript, Rust, ZK, pgvector, x402.',
    'Signature project: AMBER — persistent memory-as-a-service for AI agents, x402-metered on X Layer.',
    'Strength: designing idempotent, payment-gated write paths that never double-charge or double-write.',
    'Achievement: shipped a 33-tool MCP server (2025-06-18) with resources, prompts, completion, and elicitation.',
    'Skill: pgvector KNN recall over 1024-dim OpenAI embeddings with Redis-cached embed lookups.',
    'Achievement: Merkle-attested memory batches settled on X Layer with verifiable inclusion proofs.',
    'Strength: production hardening — structured logging, generic client errors, connection pooling, graceful shutdown.',
    'Skill: x402 exact-scheme payments (EIP-3009 USDT) with a free-tier bypass for the first 100 writes per identity.',
    'Achievement: deterministic on-chain reputation scoring across six auditable axes, no LLM or oracle.',
    'Leadership: docs-first methodology — every framework integration verified against official documentation.',
    'Skill: Fastify plugin architecture with per-prefix route groups and preHandler auth middleware.',
    'Achievement: sub-second /demo/live judge validation backed entirely by live product endpoints.',
    'Strength: security-first review against OWASP API Top 10 on every endpoint before merge.',
    'Skill: Prisma + raw parameterized SQL for pgvector inserts, never string concatenation.',
    'Achievement: Redis-backed rate limiting and sliding-window abuse protection on public tools.',
    'Strength: incident-driven testing — integration tests hit a real Postgres, never mocked.',
    'Skill: node-cron workers with isRunning guards for attestation batching and log cleanup.',
    'Career north star: make agent memory a portable, verifiable, monetizable primitive.',
  ],
  creative: [
    'Brand palette: amber #E4A853 primary, obsidian #1A1410 base, cream #FBF7ED accent.',
    'Brand voice: senior engineer, dry humor, zero marketing fluff, concise and direct.',
    'SEALSCRIBE keepsakes: wax-seal art rendered from a memory decree, provable NFT lineage via Merkle attestation.',
    'Memory Portrait: a constellation of an identity\'s memories rendered as shareable SVG art.',
    'Logo rule: the amber droplet mark never rotates and never sits on a light background.',
    'Typography: Inter for UI and decks; monospace only for hashes, addresses, and code.',
    'Motion principle: portraits animate on write, not on read; SMIL frames render at t=0 for static cards.',
    'Copy rule: never use em-dashes or double hyphens in any AMBER surface.',
    'Tagline: "Write once, recall anywhere." Memory as the primary key of agent identity.',
    'Illustration style: thin amber linework on obsidian, sparse, astronomical/constellation motifs.',
    'Social card: 1200x630, obsidian field, single amber headline, live stat in the corner.',
    'Seal decree tone: first-person, declarative, timeless — "I build on OKX.AI", not "I am building".',
    'Icon set: 1.5px stroke, rounded caps, amber on obsidian, no fills.',
    'Voice do-not: no exclamation marks, no growth-hacking verbs, no fake urgency.',
    'Portrait color mapping: category drives hue, recency drives brightness, pins drive size.',
    'Wordmark spacing: AMBER set in caps with +0.08em tracking, amber on obsidian only.',
    'Empty-state art: a single dim star with the prompt to write the first memory.',
    'Brand metaphor: memories are amber — organic moments preserved and made permanent.',
  ],
  software: [
    'X Layer deploy: PUBLIC_BASE_URL on port 3700, Postgres 15 with pgvector (1024-dim), Redis 7, Bun 1.1 runtime.',
    'Stack: Fastify 5 + Prisma 7 + @prisma/adapter-pg, ioredis, OpenAI text-embedding-3-small at 1024 dims.',
    'Write path: sanitize → embed → parameterized pgvector INSERT → bump quota → enqueue attestation.',
    'Idempotency: every write carries a clientNonce; replays return the existing row instead of duplicating.',
    'Attestation worker: node-cron drains a Redis pending:attestations list and Merkle-batches to X Layer.',
    'Rate limiting: Redis sliding-window per identity+endpoint, returns retryAfterSeconds on breach.',
    'Free tier: first 100 writes per identity bypass x402; beyond that, exact-scheme USDT payment is required.',
    'Embeddings are Redis-cached for 24h keyed on sha256(text) plus a 500-entry in-process LRU.',
    'Reputation is computed with one SQL query per axis so every score component is independently auditable.',
    'Error handling: generic messages to clients, full structured detail logged server-side with a correlation id.',
    'Health: /healthz is config-only and never calls OpenAI, so liveness never depends on a third party.',
    'DB safety: all vector inserts use $executeRawUnsafe with bound parameters — never string concatenation.',
    'Bulk writes run inserts independently (not one transaction) so one embed failure never aborts the batch.',
    'Portrait cache is busted on every write so GET /portrait/{id}.svg always reflects the latest memory.',
    'CORS is allowlisted per environment; wildcard origins are never used in production.',
    'Graceful shutdown drains in-flight requests before closing the Fastify server and DB pool.',
    'Quota reservation is atomic (conditional UPDATE) to avoid a TOCTOU race under concurrent writes.',
    'MCP transport speaks JSON-RPC 2.0 over HTTP with the 2025-06-18 protocol revision.',
  ],
  prediction: [
    'Risk tolerance: 5% max per position, high-conviction YES bets only, prefer binary markets with >70% edge.',
    'Position sizing: Kelly criterion with a 0.5x multiplier to survive variance.',
    'Edge threshold: no entry below a 70% modeled probability on binary resolution markets.',
    'Portfolio cap: never more than 25% of book across correlated prediction markets at once.',
    'Exit rule: take profit at 90% implied, cut at a 50% adverse move against the thesis.',
    'Research-to-trade: convert a written thesis into a YES buy only after a memory_query recall check.',
    'PnL review cadence: reconcile 24h delta against finance_brief every session open.',
    'Conviction ladder: size scales with edge tiers — 1% at 70%, 3% at 80%, 5% at 90%+.',
    'Market selection: prefer liquid, short-dated binaries with clear objective resolution.',
    'Bias guard: log the counter-thesis before entry to avoid confirmation bias.',
    'Correlation check: treat same-narrative markets as one position for sizing purposes.',
    'Drawdown rule: pause new entries after three consecutive losing resolutions.',
    'Hedge policy: hedge only when a single narrative exceeds 15% of book.',
    'Record-keeping: every resolved market writes a PnL memory tagged for finance_brief recall.',
    'Slippage budget: skip any entry where expected slippage erodes more than 10% of edge.',
    'Time decay: avoid long-dated markets where capital is locked with no compounding.',
    'Signal source hierarchy: on-chain flow > order-book imbalance > social sentiment.',
    'Kill switch: flatten all prediction exposure if 24h PnL delta breaches the 5% stop.',
  ],
};

export interface DemoSeedResult {
  identity: string;
  mode: 'lazy' | 'hero';
  seeded: boolean;
  skippedReason: string | null;
  memoryCountBefore: number;
  memoryCountAfter: number;
  written: number;
  pinned: number;
  replays: number;
  failures: number;
  verticalsCovered: string[];
  degraded: boolean;
}

interface SeedOptions {
  mode: 'lazy' | 'hero';
  // Per-vertical write counts.
  perVertical: number;
  // How many of each vertical's writes to pin (deliberateness axis).
  pinsPerVertical: number;
  // Wall-clock budget. When exceeded we stop writing and return what we have.
  budgetMs: number;
}

const LAZY_OPTS: SeedOptions = { mode: 'lazy', perVertical: 3, pinsPerVertical: 2, budgetMs: 20_000 };
// Hero: 18 per vertical (90 total) drives persistence to its cap band, and
// ~4 pins per vertical (20 pins) maxes the deliberateness axis. Combined with
// full breadth (5 verticals) this reaches the "established" tier locally.
const HERO_OPTS: SeedOptions = { mode: 'hero', perVertical: 18, pinsPerVertical: 4, budgetMs: 180_000 };

const activeMemoryCount = async (identityId: string): Promise<number> =>
  prismaQuery.memory.count({ where: { identityId, deletedAt: null } });

/**
 * Seed (or top up) the demo identity through the real memory_template write
 * path. Idempotent and safe to call on every request in 'lazy' mode.
 */
export const seedDemoIdentity = async (
  opts: SeedOptions,
  identityAddress: string = DEMO_IDENTITY
): Promise<DemoSeedResult> => {
  const identity = await getOrCreateIdentity(identityAddress.toLowerCase());
  const before = await activeMemoryCount(identity.id);

  const result: DemoSeedResult = {
    identity: identity.address,
    mode: opts.mode,
    seeded: false,
    skippedReason: null,
    memoryCountBefore: before,
    memoryCountAfter: before,
    written: 0,
    pinned: 0,
    replays: 0,
    failures: 0,
    verticalsCovered: [],
    degraded: false,
  };

  // Lazy mode is a top-up: skip entirely once the identity is populated so a
  // busy /demo/live never re-seeds or slows down.
  if (opts.mode === 'lazy' && before >= LAZY_SEED_THRESHOLD) {
    result.skippedReason = 'already-populated';
    return result;
  }

  // Redis NX lock prevents concurrent seeding from a burst of judge requests.
  const lockKey = `demo:seed:lock:${identity.address}`;
  let haveLock = false;
  try {
    const acquired = await redis.set(lockKey, '1', 'EX', 120, 'NX');
    haveLock = acquired === 'OK';
  } catch {
    // Redis unavailable — proceed without the lock. writeOne's per-content
    // daily nonce still guarantees idempotency, so at worst we replay.
    haveLock = true;
  }
  if (!haveLock) {
    result.skippedReason = 'seed-in-progress';
    return result;
  }

  const covered = new Set<string>();
  const deadline = Date.now() + opts.budgetMs;
  try {
    for (let i = 0; i < opts.perVertical; i++) {
      if (Date.now() > deadline) {
        result.degraded = true;
        break;
      }
      for (const vertical of TEMPLATE_VERTICAL_KEYS) {
        if (Date.now() > deadline) {
          result.degraded = true;
          break;
        }
        const bank = CONTENT_BANK[vertical];
        const content = bank?.[i % (bank?.length ?? 1)];
        if (!content) continue;
        try {
          const write = await writeVerticalMemory({
            identityAddress: identity.address,
            vertical,
            content,
            pin: i < opts.pinsPerVertical,
            paymentMode: 'free',
          });
          if (write.replay) result.replays += 1;
          else result.written += 1;
          if (write.pinned) result.pinned += 1;
          covered.add(vertical);
        } catch (err) {
          // Graceful degradation: an embeddings/DB hiccup on one write must not
          // abort the demo. Count it and keep going.
          result.failures += 1;
          result.degraded = true;
          console.warn(
            `[demoSeed] write failed (vertical=${vertical}, i=${i}):`,
            (err as Error).message
          );
        }
      }
    }
  } finally {
    redis.del(lockKey).catch(() => undefined);
  }

  result.seeded = result.written > 0 || result.replays > 0;
  result.verticalsCovered = TEMPLATE_VERTICAL_KEYS.filter((v) => covered.has(v));
  result.memoryCountAfter = await activeMemoryCount(identity.id);
  return result;
};

/** Lazy top-up used by GET /demo/live. Never throws. */
export const ensureDemoSeeded = async (
  identityAddress: string = DEMO_IDENTITY
): Promise<DemoSeedResult | null> => {
  try {
    return await seedDemoIdentity(LAZY_OPTS, identityAddress);
  } catch (err) {
    console.warn('[demoSeed] lazy seed failed:', (err as Error).message);
    return null;
  }
};

/** Full hero seed used by scripts/seed-demo.ts. */
export const seedDemoHero = async (
  identityAddress: string = DEMO_IDENTITY
): Promise<DemoSeedResult> => seedDemoIdentity(HERO_OPTS, identityAddress);
