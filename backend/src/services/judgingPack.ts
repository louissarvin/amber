import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PUBLIC_BASE_URL, XLAYER_CHAIN_ID } from '../config/main-config.ts';
import { MCP_TOOL_COUNT } from '../routes/mcpTransport.ts';
import { collectAmberStats } from './metrics.ts';

// -----------------------------------------------------------------------------
// Build X / OKX.AI judging pack.
//
// This is a judge-facing evidence packet, not a new paid marketplace service.
// It turns the official criteria into a compact, live checklist for agents,
// judges, and the Google Form submission.
// -----------------------------------------------------------------------------

// Derive the listed-service count from the committed listing manifest so it is
// always the source of truth (no hardcoded literal that can drift). MCP_TOOL_COUNT
// is derived from the tools array in mcpTransport.ts.
const listingServicesPath = fileURLToPath(
  new URL('../../scripts/listing-services.json', import.meta.url)
);
// Fall back to the known committed count (17) if the manifest is missing or
// malformed, so a bad/absent file can never crash the whole server on boot
// (judgingPack is imported transitively from index.ts).
const FALLBACK_LISTED_SERVICE_COUNT = 17;
let LISTED_SERVICE_COUNT = FALLBACK_LISTED_SERVICE_COUNT;
try {
  LISTED_SERVICE_COUNT = (
    JSON.parse(readFileSync(listingServicesPath, 'utf8')) as unknown[]
  ).length;
} catch (error) {
  console.warn(
    `[judgingPack] Could not read/parse listing-services.json, falling back to ${FALLBACK_LISTED_SERVICE_COUNT}:`,
    (error as Error).message
  );
}

const buildLaunchReadiness = (): object => {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const isHttps = PUBLIC_BASE_URL.startsWith('https://');
  const isLockedDomain = PUBLIC_BASE_URL === 'https://amber-mcp.xyz';

  if (!isHttps) {
    blockers.push('PUBLIC_BASE_URL must be HTTPS before OKX.AI listing review.');
  }
  if (!PUBLIC_BASE_URL) {
    blockers.push('PUBLIC_BASE_URL is missing.');
  }
  if (!isLockedDomain) {
    warnings.push('Production listing endpoint is locked to https://amber-mcp.xyz for agent create.');
  }

  return {
    status: blockers.length === 0 ? 'ready_for_production_smoke' : 'blocked_until_deploy_config',
    blockers,
    warnings,
    checks: {
      publicBaseUrl: PUBLIC_BASE_URL,
      publicBaseUrlHttps: isHttps,
      lockedProductionDomain: isLockedDomain,
      expectedMcpTools: MCP_TOOL_COUNT,
      expectedListedServices: LISTED_SERVICE_COUNT,
      okxAiGoLiveRequired: true,
      xPostRequired: true,
      googleFormRequired: true,
    },
    requiredProductionCommands: [
      'AMBER_BASE_URL=https://amber-mcp.xyz bash scripts/demo-flow.sh',
      'AMBER_BASE_URL=https://amber-mcp.xyz bash scripts/onchainos-x402-check.sh  # curl-based x402 probe (no onchainos x402-check CLI exists)',
      'bun scripts/validate-listing-cjk.ts',
      'onchainos validate-listing  # QA gate before create',
      'onchainos agent pre-check --role asp',
      'onchainos agent create  # via natural language in Claude Code',
      'onchainos agent activate',
    ],
  };
};

export const buildJudgingPack = async (): Promise<object> => {
  const [stats24h, stats7d] = await Promise.all([
    collectAmberStats(24),
    collectAmberStats(24 * 7),
  ]);

  return {
    schema: 'amber.buildx_judging_pack.v1',
    product: {
      name: 'AMBER',
      oneLiner:
        'The reputation memory layer for the OKX AI marketplace. Persistent memory + live Reputation Score, keyed by ERC-8004 identity, paid via x402 on X Layer.',
      corePromise: 'Write once, recall anywhere, prove reputation everywhere.',
      category: 'Software Utility',
      chain: { id: XLAYER_CHAIN_ID, name: 'X Layer' },
      thesisAlignment:
        'OKX AI says "every AI agent has a single persistent identity that accumulates reputation across all work." AMBER makes that reputation LIVE and QUERYABLE via /identity/reputation/:address — a 0-100 score computed from persistence, verification, economic activity, breadth across the 5 OKX AI verticals, deliberateness, and longevity.',
    },
    hackathon: {
      name: 'OKX.AI Genesis Hackathon',
      prizePoolUsdt: 100000,
      deadlineUtc: '2026-07-27T23:59:00.000Z',
      mustGoLiveOnOkxAi: true,
      xPost: {
        hashtag: '#OKXAI',
        maxDemoSeconds: 90,
        requirement:
          'Introduce the ASP, explain the use case, and include a clear demo or walkthrough.',
      },
      officialJudgingCriteria: [
        {
          award: 'Best Product',
          criteria:
            'Strongest product experience, service completeness, and user value.',
        },
        {
          award: 'Creative Genius',
          criteria: 'Best creativity. Use your imagination.',
        },
        {
          award: 'Revenue Rocket',
          criteria:
            'Strongest qualified revenue during the campaign period, including revenue, orders, and positive reviews.',
        },
        {
          award: 'Finance Copilot',
          criteria: 'Top-performing ASP under Finance category.',
        },
        {
          award: 'Software Utility',
          criteria: 'Top-performing ASP under Software Services category.',
        },
        {
          award: 'Lifestyle Companion',
          criteria: 'Top-performing ASP under Lifestyle category.',
        },
        {
          award: 'Artistic Excellence',
          criteria: 'Top-performing ASP under Art Creation category.',
        },
        {
          award: 'Social Buzz',
          criteria: 'Strongest social traction and community reach.',
        },
      ],
    },
    prizeStrategy: [
      {
        track: 'Best Product',
        priority: 1,
        evidence: [
          `${MCP_TOOL_COUNT} MCP tools across write, recall, session, analytics, portability, safety, and demo flows.`,
          'Full MCP 2025-06-18 spec: Tools + Resources + Prompts + Completion + Logging — every capability surface covered.',
          'AMBER is the persistent memory LAYER for the OKX AI marketplace. Every one of the 5 X Layer-announced ASP verticals (Professional Asset Creation, Resume & Career, Creative & Digital, Software Services, Prediction Markets) writes and recalls through AMBER via the memory_template tool. Cross-ASP context lock-in.',
          'Ships to all 4 OKX AI-supported MCP clients: Claude Code, Codex, OpenClaw (ClawHub skill), Hermes (federated mesh mode).',
          'Machine-readable skill manifest at /skills/amber/manifest.json — auto-discoverable by OpenClaw ClawHub (44K+ community skills) and Hermes skill hub.',
          'OnchainOS SKILL.md at /skills/amber/SKILL.md — any agent loading the skill gets instant guided AMBER access.',
          'A2MCP service type: pay-per-call x402 exact, no negotiation, no escrow — perfect match for OKX AI review criteria.',
          'One-call demo pack, whoami, memory diff, pinning, portability pack, onboarding manifest, and judging pack.',
          'Memory poisoning rejection, untrusted recall framing, hybrid recall, and privacy-preserving delete.',
          'memory_related (30th tool): pgvector KNN from any seed memory — "what else do I know about this?" in one paid call.',
          'memory_template (31st tool): one call writes a memory tagged for the exact OKX AI vertical (professional_asset / resume / creative / software / prediction). Any other ASP finds it in one memory_query.',
          'memory_habit_check (32nd tool): daily habit checkins with streak math + auto-pin — Lifestyle Companion signal that no other ASP can match.',
          'A2A envelope routing at MCP transport — supports OKX Onchain OS "envelope-based priority routing" with msgType: "a2a-agent-chat". 10 intents mapped to 10 AMBER tools.',
          '1200×630 PNG OG cards for portrait + seal via /portrait/:addr/card.png and /seal/:id/card.png — Twitter/X-ready social artifacts for Social Buzz.',
          'Native OKX Agentic Wallet compatibility: every paid call settles via EIP-3009 authorization, no per-call user confirmation once delegation is set.',
          'OpenClaw Agent Template dependency: plugs into OKX OnchainOS Agent Template (May 2026) as the memory layer with one skill install.',
          '/report/comparables — head-to-head vs Mem0 / Zep / Letta with an honest capability matrix. AMBER wins on OKX-native (identity + reputation + payment + attestation), acknowledges Zep leads on temporal graphs (LongMemEval +18.5%).',
          '/identity/reputation/:address — live AMBER Reputation Score (0-100) computed from persistence, verification, economic activity, breadth, deliberateness, longevity. Directly answers OKX AI\'s "accumulating on-chain reputation" thesis.',
          '/status/production-ready — self-service judge validation. One URL confirms every ASP-review gate (HTTPS, ASP wallet, x402 emission, tool count, DB up, X Layer RPC up).',
          '/demo/live and /demo/live/:vertical — 3-second judge validation. One URL per OKX AI vertical shows a realistic sample memory + recommended tools + cross-ASP integration path.',
          '/demo/for-vertical/:vertical — cross-ASP discovery: any other ASP on OKX AI calls this to get a 5-step wiring guide for the AMBER tools relevant to their vertical.',
          '/demo/replay-script — copy-paste bash script that reproduces the 90-second demo end-to-end. Judges validate AMBER without reading a single line of code.',
          '/public/showcase — anonymized top-3 usage stories showing real cross-vertical adoption.',
          '/public/leaderboard shows real usage: top identities by memory count (anonymized).',
          'SKILL.md is Onchain OS-compliant: full YAML frontmatter with agent.install block per client (Claude Code, Codex, OpenClaw, Hermes, Cursor) and agent.probe block for health checks. Publishable to ClawHub in one PR.',
        ],
      },
      {
        track: 'Software Utility',
        priority: 2,
        evidence: [
          'Primary OKX.AI category is Software Utility.',
          'Solves a repeatable agent workflow: persistent cross-client state across Claude Code, Codex, and any MCP client.',
          `Works through MCP (${MCP_TOOL_COUNT} tools), REST, x402 exact scheme, and Onchain OS registration metadata.`,
          'MCP completion/complete: autocomplete for memory categories and tags — production-grade developer experience.',
        ],
      },
      {
        track: 'Revenue Rocket',
        priority: 3,
        evidence: [
          'Paid x402 exact routes for memory write/query/session/share/dossier/seal/related.',
          'memory_related (30th MCP tool) adds a new 0.0005 USDT pgvector-KNN paid endpoint on top of memory_query.',
          '/report/revenue exposes campaign revenue and order evidence.',
          '/report/payers ranks top 25 payers by lifetime USDT — anonymized payer diversity signal for judges.',
          '/public/stats: live counter of payments_count, unique_payers, usdt_volume — headline counts ON-CHAIN SETTLED USD₮0 only (txHash present, verifiable on X Layer); pending authorizations shown separately.',
          '/public/payments: anonymized recent payment receipts for Revenue Rocket proof links.',
          '/public/leaderboard: shows unique active identities — payer diversity signal.',
          'Positive-review CTA is included after every paid call via X-Amber-Review header and in the revenue report.',
        ],
      },
      {
        track: 'Social Buzz',
        priority: 4,
        evidence: [
          '/social/card returns ready-to-post copy, hashtags, and a 90-second demo script.',
          '/social/badge.svg gives a live shareable badge.',
        ],
      },
      {
        track: 'Finance Copilot',
        priority: 5,
        evidence: [
          'finance_brief v2: seeds wallet history, stores a live OKX portfolio snapshot, computes 24h PnL delta vs previous snapshot, identifies top movers per token, writes a dated PnL fact memory, and returns semantic financial recall.',
          'portfolio_snapshot fetches real-time X Layer wallet holdings via OKX DEX API and writes a dated portfolio fact to memory.',
          'memory_seed_wallet bootstraps memories from on-chain activity, tx count, and balance — instant financial history.',
          'memory_related (0.0005 USDT paid) uses pgvector KNN to find every memory similar to a portfolio snapshot — instant financial context expansion.',
          'Portability pack lets financial agents export and import wallet context across Claude Code, Codex, and any MCP client.',
        ],
      },
      {
        track: 'Lifestyle Companion',
        priority: 6,
        evidence: [
          'lifestyle_remember one-call Lifestyle Companion: write + pin a personal fact/preference/goal and return whoami context.',
          'memory_whoami answers "who am I?" with preferences, facts, and a dossier in one call.',
          'memory_pin lets users anchor durable life facts (diet, timezone, goals) that persist across all agent sessions.',
          'Memory Portrait SVG shows the identity as a living constellation that grows with each memory written.',
        ],
      },
      {
        track: 'Creative Genius / Artistic Excellence',
        priority: 7,
        evidence: [
          'Identity-as-filesystem positioning.',
          'SEALSCRIBE wax-seal SVG and Memory Portrait constellation art.',
        ],
      },
    ],
    liveEvidence: {
      basis:
        'paidUsdt is ON-CHAIN SETTLED USD₮0 only (txHash present, verifiable on X Layer). authorizedUsdt includes verified EIP-3009 signatures not yet settled; pendingUsdt is the difference awaiting the paymentSettler.',
      last24h: {
        activeIdentities: stats24h.identities.activeInWindow,
        memoriesWritten: stats24h.memories.writtenInWindow,
        attestedBatches: stats24h.memories.attestedInWindow,
        settledReceipts: stats24h.payments.settledOnChainInWindow,
        paidReceipts: stats24h.payments.receiptCountInWindow,
        paidUsdt: stats24h.payments.settledPaidUsdtInWindow,
        authorizedUsdt: stats24h.payments.totalPaidUsdtInWindow,
        pendingUsdt: stats24h.payments.pendingPaidUsdtInWindow,
      },
      last7d: {
        activeIdentities: stats7d.identities.activeInWindow,
        memoriesWritten: stats7d.memories.writtenInWindow,
        attestedBatches: stats7d.memories.attestedInWindow,
        settledReceipts: stats7d.payments.settledOnChainInWindow,
        paidReceipts: stats7d.payments.receiptCountInWindow,
        paidUsdt: stats7d.payments.settledPaidUsdtInWindow,
        authorizedUsdt: stats7d.payments.totalPaidUsdtInWindow,
        pendingUsdt: stats7d.payments.pendingPaidUsdtInWindow,
      },
      totals: {
        identities: stats24h.identities.total,
        activeMemories: stats24h.memories.totalActive,
        listedServices: LISTED_SERVICE_COUNT,
        mcpTools: MCP_TOOL_COUNT,
      },
    },
    judgeDemo90s: [
      'Open /demo/live for 3-second judge validation — one URL confirms AMBER is production-ready with live stats + reputation + 5 vertical demos.',
      'Open /demo/live/professional_asset (or resume / creative / software / prediction) for the exact per-vertical sample memory + tool wiring.',
      'Open /status/production-ready — all 11 ASP-review gates in one JSON, self-service.',
      'Open /identity/reputation/0xdeadbeef000000000000000000000000deadbeef — live 0-100 score with full breakdown.',
      'Run finance_brief for a fresh ERC-8004 identity — seeds wallet + live OKX portfolio + 24h PnL delta.',
      'Run memory_template vertical="creative" — writes brand palette to memory, auto-pins, returns whoami context.',
      'Open the portrait SVG for Artistic Excellence visual proof.',
      'Open /report/judging, /public/stats, /public/payments for judge + Revenue Rocket evidence.',
    ],
    urls: {
      base: PUBLIC_BASE_URL,
      listing: `${PUBLIC_BASE_URL}/listing.json`,
      agent: `${PUBLIC_BASE_URL}/agent.json`,
      onboarding: `${PUBLIC_BASE_URL}/.well-known/amber`,
      mcpClients: `${PUBLIC_BASE_URL}/.well-known/mcp-clients.json`,
      x402: `${PUBLIC_BASE_URL}/.well-known/x402`,
      mcp: `${PUBLIC_BASE_URL}/mcp`,
      docs: `${PUBLIC_BASE_URL}/docs`,
      dailyReport: `${PUBLIC_BASE_URL}/report/daily`,
      revenueReport: `${PUBLIC_BASE_URL}/report/revenue`,
      publicStats: `${PUBLIC_BASE_URL}/public/stats`,
      publicPayments: `${PUBLIC_BASE_URL}/public/payments`,
      leaderboard: `${PUBLIC_BASE_URL}/public/leaderboard`,
      payerLeaderboard: `${PUBLIC_BASE_URL}/report/payers`,
      showcase: `${PUBLIC_BASE_URL}/public/showcase`,
      reputationExample: `${PUBLIC_BASE_URL}/identity/reputation/{identity}`,
      productionReady: `${PUBLIC_BASE_URL}/status/production-ready`,
      demoLive: `${PUBLIC_BASE_URL}/demo/live`,
      demoPerVertical: `${PUBLIC_BASE_URL}/demo/live/{vertical}`,
      demoReplayScript: `${PUBLIC_BASE_URL}/demo/replay-script`,
      crossAspDiscovery: `${PUBLIC_BASE_URL}/demo/for-vertical/{vertical}`,
      comparables: `${PUBLIC_BASE_URL}/report/comparables`,
      portraitCardPng: `${PUBLIC_BASE_URL}/portrait/{address}/card.png`,
      sealCardPng: `${PUBLIC_BASE_URL}/seal/{id}/card.png`,
      skill: `${PUBLIC_BASE_URL}/skills/amber/SKILL.md`,
      socialCard: `${PUBLIC_BASE_URL}/social/card`,
      socialBadge: `${PUBLIC_BASE_URL}/social/badge.svg`,
      judgingPack: `${PUBLIC_BASE_URL}/report/judging`,
      avatar: `${PUBLIC_BASE_URL}/assets/avatar.svg`,
    },
    submissionChecklist: [
      {
        step: 'Deploy production backend at https://amber-mcp.xyz',
        evidenceUrl: `${PUBLIC_BASE_URL}/healthz`,
      },
      {
        step: 'Verify x402 PAYMENT-REQUIRED header on paid endpoints: bash scripts/onchainos-x402-check.sh',
        evidenceUrl: `${PUBLIC_BASE_URL}/public/stats`,
      },
      {
        step: 'Create and activate AMBER ASP listing on OKX.AI via Onchain OS: onchainos validate-listing then onchainos agent pre-check --role asp then onchainos agent create then onchainos agent activate',
        evidenceUrl: `${PUBLIC_BASE_URL}/listing.json`,
      },
      {
        step: 'Post X demo with #OKXAI and <=90s walkthrough',
        evidenceUrl: `${PUBLIC_BASE_URL}/social/card`,
      },
      {
        step: 'Submit Google Form before deadline with ASP details and X post link',
        evidenceUrl: `${PUBLIC_BASE_URL}/report/judging`,
      },
    ],
    reviewCta: {
      url: 'https://www.okx.ai/marketplace',
      instructions:
        'Search "AMBER" → open the listing → click "Leave Review" after any successful paid call (memory_write, memory_query, seal_generate). Positive reviews count toward Revenue Rocket.',
    },
    launchReadiness: buildLaunchReadiness(),
    ecosystemAlignment: {
      agenticWalletCompatible: true,
      agenticWalletNote: 'Every paid AMBER call settles via EIP-3009 authorization from OKX Agentic Wallet — no per-call user confirmation needed once delegation is set.',
      openclawSkill: true,
      openclawInstallCommand: `npx skills add amber --skill-path ${PUBLIC_BASE_URL}/skills/amber/SKILL.md`,
      openclawAgentTemplateDependency: 'Plugs into the OKX OnchainOS Agent Template on OpenClaw (May 2026) as the memory dependency.',
      onchainOsScale: '1.2B API calls/day, $300M trading volume — OKX Agent Trade Kit',
      erc8004IdentityFirst: true,
      merkleAttestationOnChain: true,
      comparablesReport: `${PUBLIC_BASE_URL}/report/comparables`,
    },
    generatedAt: new Date().toISOString(),
  };
};
