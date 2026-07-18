import { PUBLIC_BASE_URL } from '../config/main-config.ts';
import { getAttestationCapability } from './attestationCapability.ts';
import { getIdentityStats } from './identityStats.ts';
import { seedWalletMemories } from './walletSeed.ts';
import { writeOne } from './memoryWriter.ts';
import { consolidateMemories } from './memoryShare.ts';
import { queryTopK } from './memoryQuery.ts';
import { getOrCreateIdentity } from './identity.ts';
import { getOrCreateQuota, hasFreeCapacity } from '../lib/quota/service.ts';

// -----------------------------------------------------------------------------
// Demo Pack — one-call judge/demo bootstrap (free, rate-limited).
// Seeds wallet facts, writes a preference, consolidates dossier, returns
// portrait + sample recall. No LLM. Uses free-tier writes only when possible.
// -----------------------------------------------------------------------------

export interface DemoPackInput {
  identityAddress: string;
  preference?: string;
}

export interface DemoPackResult {
  identity: string;
  steps: string[];
  seed: Awaited<ReturnType<typeof seedWalletMemories>>;
  preferenceMemoryId: string | null;
  dossier: { memoryId: string; sourceCount: number } | null;
  recall: { query: string; hits: number };
  portraitUrl: string;
  sealHint: string;
  onChainAttestation: Awaited<ReturnType<typeof getAttestationCapability>>;
  onchainOS: {
    mcpEndpoint: string;
    naturalLanguagePrompt: string;
    x402CheckCommand: string;
  };
}

export const runDemoPack = async (input: DemoPackInput): Promise<DemoPackResult> => {
  const identity = input.identityAddress.toLowerCase();
  const steps: string[] = [];

  steps.push('seed-wallet');
  const seed = await seedWalletMemories({ identityAddress: identity, lookbackBlocks: 0 });

  let preferenceMemoryId: string | null = null;
  const pref =
    (input.preference?.trim() ||
      'I prefer concise technical answers and persistent memory across Claude Code sessions.') +
    '';

  const quota = await getOrCreateQuota((await getOrCreateIdentity(identity)).id);
  if (hasFreeCapacity(quota)) {
    steps.push('write-preference');
    // Daily nonce so the demo pack is idempotent within a day but re-runs cleanly
    // on new days or when the user passes a different preference.
    const today = new Date().toISOString().slice(0, 10);
    try {
      const w = await writeOne({
        identityAddress: identity,
        content: pref,
        category: 'preference',
        tags: ['demo-pack', 'onboarding'],
        metadata: { source: 'demo-pack' },
        clientNonce: `demo-pack:pref:${identity}:${today}`,
        paymentMode: 'free',
      });
      preferenceMemoryId = w.memoryId;
    } catch {
      // Non-fatal: preference write failed (quota race or nonce collision).
      // The demo pack result is still valid with seed + dossier + recall.
    }
  }

  let dossier: { memoryId: string; sourceCount: number } | null = null;
  try {
    steps.push('consolidate');
    const c = await consolidateMemories({ identityAddress: identity, limit: 12 });
    dossier = { memoryId: c.memoryId, sourceCount: c.sourceCount };
  } catch {
    // consolidate needs ≥1 memory; seed should have created some
  }

  steps.push('recall');
  const recall = await queryTopK({
    identityAddress: identity,
    q: 'What are my preferences and wallet facts?',
    k: 3,
    category: null,
    since: null,
    minRelevance: 0.4,
  });

  const attestation = await getAttestationCapability();
  const mcp = `${PUBLIC_BASE_URL}/mcp`;

  return {
    identity,
    steps,
    seed,
    preferenceMemoryId,
    dossier,
    recall: {
      query: 'What are my preferences and wallet facts?',
      hits: recall.length,
    },
    portraitUrl: `${PUBLIC_BASE_URL}/portrait/${identity}.svg`,
    sealHint: `POST ${PUBLIC_BASE_URL}/seal/generate (0.05 USDT) or MCP seal_generate`,
    onChainAttestation: attestation,
    onchainOS: {
      mcpEndpoint: mcp,
      naturalLanguagePrompt: `Store this in AMBER memory for my ERC-8004 identity ${identity}: "${pref.slice(0, 120)}"`,
      x402CheckCommand: `bash scripts/onchainos-x402-check.sh  # or: curl -sI -X POST ${mcp} -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_query","arguments":{"identity":"0x0","q":"probe"}}}' | grep -i payment-required`,
    },
  };
};

export const buildOnboardingManifest = async (): Promise<Record<string, unknown>> => {
  const attestation = await getAttestationCapability();
  const mcp = `${PUBLIC_BASE_URL}/mcp`;

  return {
    name: 'AMBER',
    version: '1.0.0',
    category: 'Software Utility',
    tracks: [
      'Best Product',
      'Software Utility',
      'Artistic Excellence',
      'Creative Genius',
      'Revenue Rocket',
      'Finance Copilot',
      'Lifestyle Companion',
      'Social Buzz',
    ],
    positioning:
      'AMBER treats your ERC-8004 identity as the primary key of a persistent agent state store and on-chain finance memory layer. Portfolio snapshots, wallet history, and spending context are stored, attested on X Layer, and semantically recallable across Claude Code, Codex, and any MCP client.',
    chain: { id: 196, name: 'X Layer' },
    payment: {
      asset: 'USD₮0',
      schemes: ['exact', 'period (subscription — APP-Access header after active subscription)'],
      freeTierWritesPerIdentity: 100,
    },
    endpoints: {
      mcp,
      health: `${PUBLIC_BASE_URL}/healthz`,
      listing: `${PUBLIC_BASE_URL}/listing.json`,
      x402: `${PUBLIC_BASE_URL}/.well-known/x402`,
      portrait: `${PUBLIC_BASE_URL}/portrait/{identity}.svg`,
      report: `${PUBLIC_BASE_URL}/report/daily`,
      revenue: `${PUBLIC_BASE_URL}/report/revenue`,
      judging: `${PUBLIC_BASE_URL}/report/judging`,
      social: `${PUBLIC_BASE_URL}/social/card`,
      docs: `${PUBLIC_BASE_URL}/docs`,
      agent: `${PUBLIC_BASE_URL}/agent.json`,
    },
    mcpTools: [
      'memory_write',
      'memory_query',
      'memory_bulk_write',
      'memory_session_context',
      'memory_list',
      'memory_get',
      'memory_delete',
      'memory_seed_wallet',
      'memory_share',
      'memory_consolidate',
      'memory_verify_attestation',
      'memory_demo_pack',
      'identity_stats',
      'seal_generate',
      'portrait_get',
      'amber_onboarding',
      'portfolio_snapshot',
      'memory_analytics',
      'memory_graph',
      'memory_whoami',
      'memory_diff',
      'memory_pin',
      'memory_portability_pack',
      'amber_judging_pack',
      'finance_brief',
      'lifestyle_remember',
      'amber_live_stats',
      'daily_brief',
      'memory_goal_set',
      'memory_related',
      'memory_template',
      'memory_habit_check',
      'memory_reputation_lookup',
    ],
    onchainOS: {
      skillsInstall: 'npx skills add okx/onchainos-skills --yes -g',
      preflight: 'Read _shared/preflight.md after skill install to verify environment gates',
      walletLogin: 'onchainos wallet login <email>',
      x402Probe: `bash scripts/onchainos-x402-check.sh`,
      x402ProbeNote: 'onchainos payment pay parses the PAYMENT-REQUIRED header inline — no separate x402-check CLI command needed',
      registerPrompt: 'Help me register an A2MCP ASP on OKX.AI using Onchain OS',
      listPrompt: 'Help me list my ASP on OKX.AI using Onchain OS',
      buyerPrompts: [
        `Remember in AMBER that my ERC-8004 identity is my memory key. Store: I build agents on OKX.AI.`,
        `Query AMBER memory: what do you know about my preferences?`,
        `Run AMBER demo pack for my identity to bootstrap a judge-ready session.`,
        `Run AMBER finance_brief for my identity — seed wallet history, 24h PnL delta, top movers, and recall my X Layer portfolio.`,
        `Use AMBER lifestyle_remember to pin that I prefer dark mode and build on OKX.AI.`,
        `Use memory_related on my portfolio snapshot memoryId to expand financial context.`,
        `Show AMBER's Build X judging pack.`,
        // Cross-client narrative — write in one, recall in another.
        `Write "I ship on X Layer" in AMBER from Claude Code, then switch to Codex or OpenClaw and ask AMBER who am I — same identity, same memory.`,
        // 5 OKX AI verticals — one prompt each.
        `memory_template vertical=professional_asset content="Board deck style: 12pt Inter, amber accents, one insight per slide" — every OKX AI deck ASP will read this on the next call.`,
        `memory_template vertical=resume content="Target roles: Senior Backend Engineer at DeFi and infra teams. Strengths: TypeScript, Rust, ZK, pgvector" — makes every resume ASP better.`,
        `memory_template vertical=creative content="Brand palette: amber #E4A853 primary, deep obsidian #1A1410 base, cream #FBF7ED accent. Voice: senior engineer, dry humor, no marketing fluff."`,
        `memory_template vertical=software content="X Layer deploy: PUBLIC_BASE_URL=https://amber-mcp.xyz, port 3700, Postgres 15 with pgvector 1024-dim, Redis 7."`,
        `memory_template vertical=prediction content="Risk tolerance: 5% per position, high-conviction bets only, prefer YES on binary markets with >70% edge."`,
      ],
      paymentProtocol:
        'OKX Agent Payments Protocol — x402 v2 PAYMENT-REQUIRED / PAYMENT-SIGNATURE on X Layer USDT (EIP-3009).',
    },
    attestation,
    comparables: ['Mem0', 'Zep', 'Letta'],
    generatedAt: new Date().toISOString(),
  };
};

export const getIdentityStatsSafe = async (
  address: string
): Promise<ReturnType<typeof getIdentityStats> | { address: string; registered: false }> => {
  try {
    return await getIdentityStats(address);
  } catch (err) {
    if ((err as { code?: string }).code === 'IDENTITY_NOT_REGISTERED') {
      return { address: address.toLowerCase(), registered: false };
    }
    throw err;
  }
};
