import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PUBLIC_BASE_URL, XLAYER_CHAIN_ID } from '../config/main-config.ts';
import { collectAmberStats } from '../services/metrics.ts';
import { computeReputationScore, ReputationNotFoundError } from '../services/reputationScore.ts';
import { DEMO_IDENTITY, ensureDemoSeeded } from '../services/demoSeed.ts';
import { AmberErrorCodes, handleBadInput, handleError } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// Live judge / buyer demo endpoints.
//
// GET /demo/live — one-URL end-to-end AMBER proof: pulls live stats, runs a
// canonical reputation lookup, and returns a copy-pasteable demo transcript.
// The point: any judge can open this URL and see AMBER working in <2 seconds
// with no wallet, no setup, no CLI.
//
// GET /demo/live/:vertical — the same but scoped to one of the 5 OKX AI
// ASP categories. Shows realistic sample memory content + suggested tool
// calls for that vertical. Perfect for the 90-second X post walkthrough.
// -----------------------------------------------------------------------------

// DEMO_IDENTITY is the stable, read-only demo identity. It is defined in the
// demoSeed service (the single owner of the demo seeding routine) and re-used
// here so /demo/live can lazily top it up through the real write path.

const VerticalParamSchema = z.enum([
  'professional_asset',
  'resume',
  'creative',
  'software',
  'prediction',
]);

interface VerticalSample {
  vertical: string;
  category: 'preference' | 'fact' | 'note';
  sampleContent: string;
  sampleSubject: string;
  tags: string[];
  recommendedTools: string[];
  templateCall: string;
  followUpCall: string;
  useCase: string;
}

const VERTICAL_SAMPLES: Record<string, VerticalSample> = {
  professional_asset: {
    vertical: 'professional_asset',
    category: 'fact',
    sampleSubject: 'Q3 board deck style',
    sampleContent:
      'Deck template: 12pt Inter, amber #E4A853 accent, one insight per slide, dark obsidian background, cream text.',
    tags: ['okx-ai', 'asset-creation', 'professional', 'template'],
    recommendedTools: ['memory_template', 'memory_query', 'memory_bulk_write'],
    templateCall: `memory_template({ identity: "0x<w>", vertical: "professional_asset", content: "Deck template: 12pt Inter, amber accents" })`,
    followUpCall: `memory_query({ identity: "0x<w>", q: "my deck template style" })`,
    useCase:
      'Deck-generation ASP reads the user\'s style once; every subsequent presentation matches without re-prompting.',
  },
  resume: {
    vertical: 'resume',
    category: 'fact',
    sampleSubject: 'Career target profile',
    sampleContent:
      'Target roles: Senior Backend Engineer at DeFi and infra teams. Strengths: TypeScript, Rust, ZK, pgvector, x402. Preferred stack: Fastify + Prisma + Postgres.',
    tags: ['okx-ai', 'resume', 'career', 'ats', 'professional'],
    recommendedTools: ['memory_template', 'memory_seed_wallet', 'memory_query'],
    templateCall: `memory_template({ identity: "0x<w>", vertical: "resume", content: "Target: Senior Backend at DeFi teams. Strengths: TS, Rust, ZK, pgvector" })`,
    followUpCall: `memory_query({ identity: "0x<w>", q: "career target and technical strengths" })`,
    useCase:
      'Resume-builder ASP produces ATS-tuned outputs on every call because AMBER holds the ground truth about the user\'s career.',
  },
  creative: {
    vertical: 'creative',
    category: 'preference',
    sampleSubject: 'Brand identity v2',
    sampleContent:
      'Brand palette: amber #E4A853 primary, obsidian #1A1410 base, cream #FBF7ED accent. Voice: senior engineer, dry humor, zero marketing fluff.',
    tags: ['okx-ai', 'creative', 'brand', 'design', 'nft'],
    recommendedTools: ['memory_template', 'portrait_get', 'seal_generate'],
    templateCall: `memory_template({ identity: "0x<w>", vertical: "creative", content: "Brand palette: amber #E4A853, obsidian #1A1410, cream #FBF7ED" })`,
    followUpCall: `portrait_get({ identity: "0x<w>" }) → shareable SVG constellation art`,
    useCase:
      'Creative ASP produces on-brand output because AMBER holds palette, voice, and past assets — plus provable NFT lineage via Merkle attestation.',
  },
  software: {
    vertical: 'software',
    category: 'note',
    sampleSubject: 'Production deploy config',
    sampleContent:
      'X Layer deploy: PUBLIC_BASE_URL=https://amber-mcp.xyz, port 3700, Postgres 15 with pgvector 1024-dim, Redis 7. Bun 1.1 runtime.',
    tags: ['okx-ai', 'software', 'devops', 'schema', 'code'],
    recommendedTools: ['memory_template', 'memory_bulk_write', 'memory_related'],
    templateCall: `memory_template({ identity: "0x<w>", vertical: "software", content: "Deploy: Postgres 15 pgvector, Redis 7, Bun 1.1" })`,
    followUpCall: `memory_related({ identity: "0x<w>", memoryId: "<seed>" }) → pgvector KNN across your codebase notes`,
    useCase:
      'Software-services ASP (app gen, DB mgmt, ML infra) reads the user\'s stack once; every subsequent code output matches the real target environment.',
  },
  prediction: {
    vertical: 'prediction',
    category: 'fact',
    sampleSubject: 'Risk profile + market conviction',
    sampleContent:
      'Risk tolerance: 5% max per position, high-conviction YES bets only, prefer binary markets with >70% edge. Position sizing: Kelly criterion with 0.5× multiplier.',
    tags: ['okx-ai', 'prediction-market', 'trading', 'conviction', 'pnl'],
    recommendedTools: ['memory_template', 'finance_brief', 'memory_related'],
    templateCall: `memory_template({ identity: "0x<w>", vertical: "prediction", content: "Risk: 5% per position, high-conviction YES on >70% edge" })`,
    followUpCall: `finance_brief({ identity: "0x<w>" }) → 24h PnL delta + portfolio + prediction memory`,
    useCase:
      'Prediction-market execution ASP reads your risk profile and past PnL, then converts research into a YES buy without a manual hop.',
  },
};

const buildLiveDemo = async (): Promise<Record<string, unknown>> => {
  // Kick off the lazy top-up in the BACKGROUND (fire-and-forget) so /demo/live
  // stays fast on a cold identity and honours its 3-second judge-validation
  // promise. ensureDemoSeeded is idempotent, so partial progress accumulates
  // across hits until the identity is fully populated; a subsequent request
  // then reflects the richer state. ensureDemoSeeded already swallows its own
  // errors, but we defensively .catch here too so no unhandled rejection can
  // ever escape. The response is built from whatever live state exists now.
  void ensureDemoSeeded().catch(() => undefined);

  const stats = await collectAmberStats(24);
  let reputation: Awaited<ReturnType<typeof computeReputationScore>> | null = null;
  try {
    reputation = await computeReputationScore(DEMO_IDENTITY);
  } catch (err) {
    if (!(err instanceof ReputationNotFoundError)) throw err;
  }

  return {
    title: 'AMBER Live Demo — 3-second judge validation',
    subtitle: 'Every URL below is live. Click any one to verify AMBER is production-ready.',
    demoIdentity: DEMO_IDENTITY,
    demonstration: {
      isDemonstrationIdentity: true,
      note:
        'This is AMBER\'s public demonstration identity. Every memory below was written through the real memory_template path (real OpenAI embeddings, real pgvector, real reputation math) — no mock data.',
      // Reflects the live state now. The background top-up (kicked off above)
      // populates the identity across hits, so this count rises until seeded.
      seededMemories: reputation?.totalMemories ?? null,
      // Authoritative coverage from the reputation scorer (reflects the whole
      // identity as it currently stands).
      verticalsCovered: reputation?.breakdown.breadth.verticalsUsed ?? [],
      degraded: false,
      heroSeedCommand: 'bun scripts/seed-demo.ts',
    },
    reputation: reputation
      ? {
          score: reputation.score,
          tier: reputation.tier,
          summary: reputation.summary,
          breadth: reputation.breakdown.breadth.verticalsUsed,
        }
      : {
          score: 0,
          tier: 'unseen',
          summary:
            'Demo identity seeding in progress or embeddings temporarily unavailable — retry in a moment.',
        },
    liveStats: {
      windowHours: stats.windowHours,
      memoriesWritten24h: stats.memories.writtenInWindow,
      activeIdentities24h: stats.identities.activeInWindow,
      attestedBatches24h: stats.memories.attestedInWindow,
      totalActiveMemories: stats.memories.totalActive,
      pricingUsdt: {
        write: '0.001',
        query: '0.0005',
        related: '0.0005',
        seal: '0.05',
      },
    },
    ninetySecondDemo: [
      `1) POST /mcp with tool="memory_write" — first 100 writes free per identity`,
      `2) POST /mcp with tool="finance_brief" — seeds X Layer wallet + 24h PnL delta`,
      `3) POST /mcp with tool="memory_whoami" — one-call identity context`,
      `4) POST /mcp with tool="memory_template", vertical="creative" — writes brand palette + auto-pins`,
      `5) GET /identity/reputation/${DEMO_IDENTITY} — see the live 0-100 score`,
      `6) GET /portrait/${DEMO_IDENTITY}.svg — memory constellation art`,
    ],
    verticalDemos: Object.keys(VERTICAL_SAMPLES).map((v) => ({
      vertical: v,
      liveUrl: `${PUBLIC_BASE_URL}/demo/live/${v}`,
    })),
    verifyProductionReady: `${PUBLIC_BASE_URL}/status/production-ready`,
    verifyPaymentEmitting: `${PUBLIC_BASE_URL}/.well-known/x402`,
    reputation_url: `${PUBLIC_BASE_URL}/identity/reputation/${DEMO_IDENTITY}`,
    portrait_url: `${PUBLIC_BASE_URL}/portrait/${DEMO_IDENTITY}.svg`,
    stats_url: `${PUBLIC_BASE_URL}/public/stats`,
    judgingPack: `${PUBLIC_BASE_URL}/report/judging`,
    generatedAt: new Date().toISOString(),
  };
};

const handleLiveDemo = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  try {
    const data = await buildLiveDemo();
    reply.header('Cache-Control', 'public, max-age=15');
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    return handleError(reply, 500, 'live demo failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleVerticalDemo = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { vertical } = request.params as { vertical?: string };
  const parsed = VerticalParamSchema.safeParse(vertical);
  if (!parsed.success) {
    return handleBadInput(
      reply,
      `vertical must be one of: professional_asset, resume, creative, software, prediction`
    );
  }
  const sample = VERTICAL_SAMPLES[parsed.data];
  if (!sample) {
    return handleError(reply, 404, 'vertical sample not found', AmberErrorCodes.INTERNAL);
  }

  reply.header('Cache-Control', 'public, max-age=300');
  return reply.code(200).send({
    success: true,
    error: null,
    data: {
      title: `AMBER × OKX AI — ${parsed.data} vertical demo`,
      vertical: parsed.data,
      chain: { id: XLAYER_CHAIN_ID, name: 'X Layer' },
      sampleMemory: {
        subject: sample.sampleSubject,
        content: sample.sampleContent,
        category: sample.category,
        tags: sample.tags,
      },
      recommendedTools: sample.recommendedTools,
      templateCall: sample.templateCall,
      followUpCall: sample.followUpCall,
      useCase: sample.useCase,
      demoIdentity: DEMO_IDENTITY,
      links: {
        skillManifest: `${PUBLIC_BASE_URL}/skills/amber/manifest.json`,
        mcpEndpoint: `${PUBLIC_BASE_URL}/mcp`,
        allVerticalDemos: `${PUBLIC_BASE_URL}/demo/live`,
        reputationScore: `${PUBLIC_BASE_URL}/identity/reputation/${DEMO_IDENTITY}`,
        portrait: `${PUBLIC_BASE_URL}/portrait/${DEMO_IDENTITY}.svg`,
      },
      generatedAt: new Date().toISOString(),
    },
  });
};

// GET /demo/replay-script — bash one-liner buyer walkthrough. Copy-paste
// friendly. Any judge can run this against localhost or production to
// reproduce the 90s demo end-to-end.
const handleReplayScript = async (
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> => {
  const base = PUBLIC_BASE_URL.replace(/\/+$/, '');
  const script = `#!/usr/bin/env bash
# AMBER 90-second buyer demo. No wallet needed for reads.
set -eu
BASE="\${AMBER_BASE_URL:-${base}}"
IDENT="\${AMBER_IDENTITY:-${DEMO_IDENTITY}}"

echo "── AMBER live proof (${new Date().toISOString().slice(0, 10)}) ──"

echo "1) /healthz"; curl -sf "$BASE/healthz" | head -c 200; echo

echo "2) reputation for $IDENT"; curl -sf "$BASE/identity/reputation/$IDENT" | head -c 400; echo

echo "3) top 3 identities (showcase)"; curl -sf "$BASE/public/showcase" | head -c 400; echo

echo "4) live stats"; curl -sf "$BASE/public/stats" | head -c 300; echo

echo "5) x402 challenge on paid query"; curl -si "$BASE/memory/query?identity=$IDENT&q=test" | grep -iE '^HTTP|payment-required' | head -3

echo "6) skill manifest"; curl -sf "$BASE/skills/amber/manifest.json" | head -c 300; echo

echo "── Done. All 6 checks live. Submit to the OKX AI Google Form. ──"
`;
  reply.header('Content-Type', 'text/plain; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=300');
  return reply.code(200).send(script);
};

// GET /demo/for-vertical/:vertical — cross-ASP discovery routing. Any ASP on
// OKX AI can call this to learn: "for my vertical, which AMBER tools should I
// wire up first?" Returns a lean recommended-action pack. Feeds the network
// effect: more ASPs discovering AMBER → more paid calls → Revenue Rocket.
const handleForVertical = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { vertical } = request.params as { vertical?: string };
  const parsed = VerticalParamSchema.safeParse(vertical);
  if (!parsed.success) {
    return handleBadInput(
      reply,
      `vertical must be one of: professional_asset, resume, creative, software, prediction`
    );
  }
  const sample = VERTICAL_SAMPLES[parsed.data];
  if (!sample) {
    return handleError(reply, 404, 'vertical not found', AmberErrorCodes.INTERNAL);
  }

  reply.header('Cache-Control', 'public, max-age=300');
  return reply.code(200).send({
    success: true,
    error: null,
    data: {
      forVertical: parsed.data,
      recommendedIntegration: [
        `1. Register AMBER MCP endpoint: ${PUBLIC_BASE_URL}/mcp`,
        `2. On every user session, call memory_whoami first (free)`,
        `3. Read the user's ${parsed.data} context via memory_query with q="${sample.useCase.slice(0, 60)}"`,
        `4. When your ASP produces new context, call ${sample.templateCall.split('(')[0]}({identity, vertical: "${parsed.data}"})`,
        `5. Gate high-trust operations behind /identity/reputation/{address} score >= 25`,
      ],
      firstToolToWire: sample.recommendedTools[0],
      secondToolToWire: sample.recommendedTools[1],
      thirdToolToWire: sample.recommendedTools[2],
      readOnlyDemoUrl: `${PUBLIC_BASE_URL}/demo/live/${parsed.data}`,
      pricing: {
        writesFreeUpTo: 100,
        writeUsdt: '0.001',
        queryUsdt: '0.0005',
        relatedUsdt: '0.0005',
      },
      reputationGateExample: `curl -sf ${PUBLIC_BASE_URL}/identity/reputation/0x<user> | jq '.data.score >= 25'`,
      skillManifest: `${PUBLIC_BASE_URL}/skills/amber/manifest.json`,
      generatedAt: new Date().toISOString(),
    },
  });
};

export const demoRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get('/live/:vertical', handleVerticalDemo);
  app.get('/live', handleLiveDemo);
  app.get('/replay-script', handleReplayScript);
  app.get('/for-vertical/:vertical', handleForVertical);
  done();
};
