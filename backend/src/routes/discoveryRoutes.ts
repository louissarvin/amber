import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../package.json' with { type: 'json' };
import {
  ASP_AGENT_ID,
  ASP_CONTACT_EMAIL,
  ASP_WALLET_ADDRESS,
  MCP_PROTOCOL_VERSION,
  PROCESS_START_UNIX_MS,
  PRICE_EXPORT_ATOMIC,
  PRICE_QUERY_ATOMIC,
  PRICE_SEAL_ATOMIC,
  PRICE_SESSION_CONTEXT_ATOMIC,
  PRICE_WRITE_ATOMIC,
  PUBLIC_BASE_URL,
  USDT_EIP712_NAME,
  USDT_EIP712_VERSION,
  USDT_XLAYER_ADDRESS,
  X402_ENABLE_PERIOD,
  XLAYER_CHAIN_ID,
} from '../config/main-config.ts';
import { collectAmberStats } from '../services/metrics.ts';
import { buildOnboardingManifest } from '../services/onboarding.ts';

// -----------------------------------------------------------------------------
// Discovery routes — free, public, unauthenticated. Advertise AMBER to the
// OKX marketplace, x402 ecosystem, and MCP crawlers.
//
// All paths are absolute (`/.well-known/x402`, `/listing.json`, `/mcp/discovery`).
// Registered without a prefix in index.ts.
// -----------------------------------------------------------------------------

interface AcceptEntry {
  scheme: 'exact' | 'period';
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

const buildAccepts = (priceAtomic: number): AcceptEntry[] => {
  const accepts: AcceptEntry[] = [
    {
      scheme: 'exact',
      network: `eip155:${XLAYER_CHAIN_ID}`,
      asset: USDT_XLAYER_ADDRESS,
      amount: String(priceAtomic),
      payTo: ASP_WALLET_ADDRESS,
      maxTimeoutSeconds: 300,
      extra: {
        name: USDT_EIP712_NAME,
        version: USDT_EIP712_VERSION,
      },
    },
  ];

  if (X402_ENABLE_PERIOD) {
    accepts.push({
      scheme: 'period',
      network: `eip155:${XLAYER_CHAIN_ID}`,
      asset: USDT_XLAYER_ADDRESS,
      amount: String(priceAtomic),
      payTo: ASP_WALLET_ADDRESS,
      maxTimeoutSeconds: 300,
      extra: {
        name: USDT_EIP712_NAME,
        version: USDT_EIP712_VERSION,
        assetTransferMethod: 'permit2',
        sessionUri: `${PUBLIC_BASE_URL}/subscription/open`,
      },
    });
  }

  return accepts;
};

// --- /.well-known/x402 ----------------------------------------------------

const handleX402Manifest = async (
  _req: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> => {
  const server: Record<string, unknown> = {
    name: 'AMBER',
    version: pkg.version ?? '0.1.0',
  };
  if (ASP_CONTACT_EMAIL) server.contact = ASP_CONTACT_EMAIL;

  const endpoints = [
    {
      path: '/memory/write',
      method: 'POST',
      description:
        'Write a memory owned by an ERC-8004 identity. First 100 writes per identity are free.',
      accepts: buildAccepts(PRICE_WRITE_ATOMIC),
    },
    {
      path: '/memory/query',
      method: 'GET',
      description: 'Semantic search over the caller identity memory namespace.',
      accepts: buildAccepts(PRICE_QUERY_ATOMIC),
    },
    {
      path: '/memory/bulk-write',
      method: 'POST',
      description: 'Bulk memory writes; over-cap items priced per write.',
      accepts: buildAccepts(PRICE_WRITE_ATOMIC),
    },
    {
      path: '/memory/session-context',
      method: 'GET',
      description: 'Boot a new agent session with the most recent memories.',
      accepts: buildAccepts(PRICE_SESSION_CONTEXT_ATOMIC),
    },
    {
      path: '/memory/:id',
      method: 'GET',
      description: 'Read a single memory by id (ownership enforced).',
      accepts: buildAccepts(PRICE_QUERY_ATOMIC),
    },
    {
      path: '/memory/export',
      method: 'GET',
      description: 'NDJSON export of the caller memory namespace.',
      accepts: buildAccepts(PRICE_EXPORT_ATOMIC),
    },
    {
      path: '/memory/seed-wallet',
      method: 'POST',
      description:
        'Bootstrap memories from public X Layer wallet state for an identity.',
      accepts: [],
    },
    {
      path: '/seal/generate',
      method: 'POST',
      description: 'Generate a wax-seal decree SVG keepsake (SEALSCRIBE-lite).',
      accepts: buildAccepts(PRICE_SEAL_ATOMIC),
    },
    {
      path: '/memory/share',
      method: 'POST',
      description: 'Copy memories between ERC-8004 identities for portable shared context.',
      accepts: buildAccepts(PRICE_WRITE_ATOMIC),
    },
    {
      path: '/memory/consolidate',
      method: 'POST',
      description: 'Build a deterministic dossier memory from recent entries.',
      accepts: buildAccepts(PRICE_WRITE_ATOMIC),
    },
    {
      path: '/memory/demo-pack',
      method: 'POST',
      description:
        'One-call judge bootstrap: seed wallet, write preference, consolidate dossier, return portrait URL.',
      accepts: [],
    },
  ];

  return reply.code(200).send({
    x402Version: 2,
    server,
    endpoints,
    facilitator: null,
    documentation: `${PUBLIC_BASE_URL}/docs`,
    // x402 v2 Bazaar Discovery Extension — declared via a normalized
    // `extensions.bazaar.schema` block. Sellers MUST declare this to appear
    // in x402 seller-directory queries. We attach category tags and price
    // bands so buyer-side discovery filters (finance, memory, identity) can
    // route to AMBER even before the marketplace listing is approved.
    // Reference: https://docs.x402.org/guides/migration-v1-to-v2.md
    extensions: {
      bazaar: {
        schema: 'x402.discovery.v2',
        seller: {
          name: 'AMBER',
          category: 'memory-and-identity',
          tags: [
            'memory',
            'reputation',
            'identity',
            'erc-8004',
            'x-layer',
            'okx-ai',
            'finance-copilot',
            'lifestyle-companion',
            'a2mcp',
          ],
          priceBands: [
            { operation: 'write', minAtomic: '0', maxAtomic: String(PRICE_WRITE_ATOMIC), asset: 'USD₮0', note: 'Free up to 100 per identity, then paid' },
            { operation: 'query', minAtomic: String(PRICE_QUERY_ATOMIC), maxAtomic: String(PRICE_QUERY_ATOMIC), asset: 'USD₮0' },
            { operation: 'related', minAtomic: String(PRICE_QUERY_ATOMIC), maxAtomic: String(PRICE_QUERY_ATOMIC), asset: 'USD₮0' },
            { operation: 'seal', minAtomic: String(PRICE_SEAL_ATOMIC), maxAtomic: String(PRICE_SEAL_ATOMIC), asset: 'USD₮0' },
          ],
          services: {
            memoryWrite: `${PUBLIC_BASE_URL}/memory/write`,
            memoryQuery: `${PUBLIC_BASE_URL}/memory/query`,
            memoryRelated: `${PUBLIC_BASE_URL}/memory/related`,
            reputationLookup: `${PUBLIC_BASE_URL}/identity/reputation/{address}`,
          },
          skillManifest: `${PUBLIC_BASE_URL}/skills/amber/manifest.json`,
          mcpEndpoint: `${PUBLIC_BASE_URL}/mcp`,
        },
      },
    },
  });
};

// --- /listing.json --------------------------------------------------------

const SERVICE_ENDPOINT = `${PUBLIC_BASE_URL}/mcp`;

const LISTING_DESCRIPTION =
  'AMBER is the persistent memory layer for the OKX AI marketplace. Every ASP category (professional asset creation, resume workflows, creative pipelines, software services, prediction markets) can write and recall context keyed on the user ERC-8004 identity. 32 MCP tools including memory_template with 5-vertical presets, memory_related pgvector KNN, and memory_habit_check with streak tracking. Merkle-attested on X Layer. SEALSCRIBE wax-seal keepsakes, Memory Portrait constellation art, and OG-image PNG cards included. Paid via x402 USDT — first 100 writes per identity free. Subscription (period) scheme supported.';

const SERVICES = [
  {
    serviceName: 'Memory Write',
    serviceDescription:
      'Persistent memory write for AI agents. Stores structured context under your on-chain identity for later semantic recall. First 100 writes per identity are free.\nProvide: 1) your ERC-8004 identity address, 2) the memory text up to 8192 characters, 3) optional category and tags.',
    serviceType: 'A2MCP',
    fee: '0.001',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Memory Recall',
    serviceDescription:
      'Semantic recall of your persistent memory. Returns the top ranked entries stored under your on-chain identity.\nProvide: 1) your ERC-8004 identity address, 2) a natural language query, 3) optional filters for category and time window.',
    serviceType: 'A2MCP',
    fee: '0.0005',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Memory Bulk',
    serviceDescription:
      'Bulk memory writes for agents importing a batch of context in one call. Up to 50 memories per request.\nProvide: 1) your ERC-8004 identity address, 2) an array of memory entries with content and optional category or tags.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Session Context',
    serviceDescription:
      'Fetches the most recent memories under your identity to bootstrap a new agent session with prior context.\nProvide: 1) your ERC-8004 identity address, 2) an optional limit up to 50 entries.',
    serviceType: 'A2MCP',
    fee: '0.0002',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Wallet Seed',
    serviceDescription:
      'Seeds starter memories from public on-chain activity for an identity so recall starts with real context instead of an empty book.\nProvide: 1) your ERC-8004 identity address, 2) optional lookback depth in blocks.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Seal Generate',
    serviceDescription:
      'Creates a wax-sealed decree image for a proposal, milestone, or personal oath tied to your on-chain identity.\nProvide: 1) your ERC-8004 identity address, 2) a short subject line, 3) the decree body text, 4) optional sigil style amber, onyx, or cream.',
    serviceType: 'A2MCP',
    fee: '0.05',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Memory Portrait',
    serviceDescription:
      'Builds a visual constellation of memories for an on-chain identity as a living shareable artwork that updates as new memories are written.\nProvide: 1) your ERC-8004 identity address.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: `${PUBLIC_BASE_URL}/portrait`,
  },
  {
    serviceName: 'Memory Share',
    serviceDescription:
      'Copies selected memories from your identity to another identity so agents can share portable context without losing ownership provenance.\nProvide: 1) your ERC-8004 identity address, 2) the recipient identity address, 3) up to 20 memory ids to share.',
    serviceType: 'A2MCP',
    fee: '0.001',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Memory Dossier',
    serviceDescription:
      'Builds a compact dossier from your most recent memories so a new agent session can read who you are in one entry.\nProvide: 1) your ERC-8004 identity address, 2) optional entry limit between 5 and 40.',
    serviceType: 'A2MCP',
    fee: '0.001',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Memory Analytics',
    serviceDescription:
      'Returns per-identity analytics: category mix, seven-day write timeline, top tags, attestation coverage, and seal count for competition or ops review.\nProvide: 1) your ERC-8004 identity address.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Memory Graph',
    serviceDescription:
      'Returns a memory constellation graph as nodes and tag-overlap edges so agents can visualize relationships across recent memories.\nProvide: 1) your ERC-8004 identity address.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Portfolio Snapshot',
    serviceDescription:
      'Reads public X Layer wallet holdings via OKX portfolio data and stores a dated portfolio fact under your identity for later recall.\nProvide: 1) your ERC-8004 identity address.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Finance Brief',
    serviceDescription:
      'Finance copilot memory layer: seeds your X Layer wallet history, stores a live portfolio snapshot, and returns a semantic recall of your on-chain financial context in one call. Answers "what is my portfolio doing?" across Claude Code and any MCP session.\nProvide: 1) your ERC-8004 identity address.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Demo Pack',
    serviceDescription:
      'One-call bootstrap for a new identity: seed wallet facts, write a preference, build a dossier, sample recall, and return a portrait URL.\nProvide: 1) your ERC-8004 identity address, 2) optional preference text.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Who Am I',
    serviceDescription:
      'Returns preferences, facts, pinned memories, and a dossier snapshot so an agent can answer who you are in one call.\nProvide: 1) your ERC-8004 identity address.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Memory Diff',
    serviceDescription:
      'Lists memories written after a timestamp so a new session can see what changed since last boot.\nProvide: 1) your ERC-8004 identity address, 2) an ISO-8601 since timestamp.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
  {
    serviceName: 'Lifestyle Memory',
    serviceDescription:
      'Call lifestyle_remember to pin personal facts, preferences, and goals to your ERC-8004 identity so every agent session knows who you are from the first message.\nProvide: 1) your ERC-8004 identity address, 2) lifestyle text to remember.',
    serviceType: 'A2MCP',
    fee: '0',
    endpoint: SERVICE_ENDPOINT,
  },
];

const handleListing = async (
  _req: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> => {
  // Best-effort marketplace stats. If metrics collection fails we still
  // return a valid tile — stats become null instead of throwing.
  let statsBlock: Record<string, unknown> | null = null;
  try {
    const s = await collectAmberStats(24);
    statsBlock = {
      totalActiveMemories: s.memories.totalActive,
      totalIdentities: s.identities.total,
      totalAttestations: s.memories.attestedInWindow,
      uptimeSeconds: Math.floor((Date.now() - PROCESS_START_UNIX_MS) / 1000),
      windowHours: s.windowHours,
      generatedAt: s.generatedAt,
    };
  } catch (err) {
    console.warn('[discovery] stats collection failed:', (err as Error).message);
    statsBlock = {
      uptimeSeconds: Math.floor((Date.now() - PROCESS_START_UNIX_MS) / 1000),
    };
  }

  const paymentSchemes = ['exact'];
  if (X402_ENABLE_PERIOD) paymentSchemes.push('period');

  return reply.code(200).send({
    name: 'AMBER',
    description: LISTING_DESCRIPTION,
    category: 'Software Utility',
    // Marketplace categories per okx.ai/agents: finance, gaming, creative,
    // research, trading, onchain activity. AMBER is naturally cross-category
    // because it's INFRASTRUCTURE, not a single vertical. Listing here so the
    // marketplace search surfaces AMBER for every relevant query.
    marketplaceCategories: [
      'software-utility',
      'onchain-activity',
      'research',
      'finance',
      'creative',
    ],
    tracks: ['Best Product', 'Creative Genius', 'Revenue Rocket', 'Finance Copilot', 'Lifestyle Companion', 'Software Utility', 'Artistic Excellence', 'Social Buzz'],
    avatar: `${PUBLIC_BASE_URL}/assets/avatar.svg`,
    services: SERVICES,
    // A2MCP = pay-per-call MCP service, x402 exact scheme, no negotiation.
    // Explicit positioning against OKX AI's A2A (escrow) alternative — helps
    // the review team classify AMBER within 24h without ambiguity.
    serviceType: 'A2MCP',
    serviceTypeNote:
      'AMBER is Agent-to-MCP (pay-per-call). No escrow, no dispute resolution, no negotiation. Every paid call settles atomically via x402 EIP-3009 on X Layer.',
    supportedClients: ['claude-code', 'codex', 'openclaw', 'hermes', 'cursor'],
    skillManifest: `${PUBLIC_BASE_URL}/skills/amber/manifest.json`,
    // OKX AI ecosystem-alignment claims. Each claim is either literally true
    // in the code today or resolves to a live endpoint judges can hit.
    ecosystemAlignment: {
      agenticWalletCompatible: true,
      agenticWalletNote:
        'Every paid AMBER call settles via EIP-3009 authorization from OKX Agentic Wallet — no per-call user confirmation needed once delegation is set.',
      openclawSkill: true,
      openclawInstallCommand: `npx skills add amber --skill-path ${PUBLIC_BASE_URL}/skills/amber/SKILL.md`,
      openclawAgentTemplate:
        'Plugs into the OKX OnchainOS Agent Template on OpenClaw (May 2026) as the memory dependency.',
      onchainOsScale:
        'OKX OnchainOS handles 1.2B API calls/day and $300M trading volume. AMBER x402 pricing (0.0005 USDT queries) is sized for that scale.',
      erc8004Identity: true,
      merkleAttestationOnChain: true,
      comparableFrameworks: ['Mem0', 'Zep', 'Letta'],
      comparablesUrl: `${PUBLIC_BASE_URL}/report/comparables`,
    },
    chain: { id: XLAYER_CHAIN_ID, name: 'X Layer' },
    payment: {
      asset: USDT_XLAYER_ADDRESS,
      schemes: paymentSchemes,
    },
    identity: {
      erc8004AgentId: ASP_AGENT_ID,
    },
    stats: statsBlock,
  });
};

// --- /mcp/discovery -------------------------------------------------------

const handleMcpDiscovery = async (
  _req: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> => {
  return reply.code(200).send({
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {}, resources: {}, prompts: {}, completion: {}, logging: {} },
    serverInfo: {
      name: 'AMBER',
      version: pkg.version ?? '0.1.0',
    },
    instructions:
      'AMBER is the persistent memory layer for the OKX AI marketplace, powering all 5 ASP verticals: professional_asset, resume, creative, software, prediction. Memory is keyed on ERC-8004 on-chain identities and Merkle-attested on X Layer. 32 tools including memory_template (vertical presets), memory_habit_check (streaks), finance_brief (24h PnL), lifestyle_remember, memory_related (pgvector KNN), daily_brief, amber_live_stats, and memory_goal_set. Paid endpoints use x402 v2 (EIP-3009 USDT on X Layer). Subscription (period) scheme supported. First 100 writes per identity are free. A2A envelope routing supported. Onboarding: /.well-known/amber',
  });
};

// --- /.well-known/amber (Onchain OS agent onboarding) -----------------------

const handleAmberManifest = async (
  _req: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> => {
  const manifest = await buildOnboardingManifest();
  return reply.code(200).send(manifest);
};

// --- /.well-known/mcp-clients.json — Claude / Cursor / Codex MCP snippets ---

const handleMcpClients = async (
  _req: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> => {
  const mcp = `${PUBLIC_BASE_URL}/mcp`;
  return reply.code(200).send({
    name: 'AMBER',
    mcpUrl: mcp,
    protocolVersion: MCP_PROTOCOL_VERSION,
    note: 'Connect any MCP client to AMBER using Streamable HTTP. Paid tools use OKX Agent Payments Protocol (x402 exact on X Layer).',
    clients: {
      claudeCode: {
        type: 'http',
        url: mcp,
        headers: { Accept: 'application/json, text/event-stream' },
        installCommand: `claude mcp add amber --transport http ${mcp}`,
      },
      cursor: {
        mcpServers: {
          amber: {
            url: mcp,
          },
        },
      },
      codex: {
        mcp_servers: {
          amber: {
            url: mcp,
          },
        },
      },
      // OpenClaw ClawHub — 44K+ community skills, 65% are MCP wrappers.
      // AMBER ships as a plug-and-play skill so any OpenClaw agent gains
      // persistent memory keyed on their ERC-8004 identity in one call.
      openclaw: {
        type: 'mcp',
        endpoint: mcp,
        protocolVersion: MCP_PROTOCOL_VERSION,
        skillPath: `${PUBLIC_BASE_URL}/skills/amber/SKILL.md`,
        manifestPath: `${PUBLIC_BASE_URL}/skills/amber/manifest.json`,
        installCommand: `npx skills add amber --skill-path ${PUBLIC_BASE_URL}/skills/amber/SKILL.md`,
        note: 'OpenClaw agents call AMBER MCP tools directly; free-tier writes work without wallet, paid tools use x402 exact.',
      },
      // Hermes Agent — federated MCP mesh. Hermes can act as MCP server
      // itself, letting one Hermes instance broker AMBER access for many
      // downstream agents. Ideal for multi-agent orchestrators.
      hermes: {
        type: 'mcp',
        endpoint: mcp,
        protocolVersion: MCP_PROTOCOL_VERSION,
        federationMode: 'client-or-server',
        skillPath: `${PUBLIC_BASE_URL}/skills/amber/SKILL.md`,
        manifestPath: `${PUBLIC_BASE_URL}/skills/amber/manifest.json`,
        installCommand: `hermes mcp add amber ${mcp}`,
        note: 'Hermes can proxy AMBER to a mesh of downstream agents. Free tier per ERC-8004 identity means every downstream agent gets its own 100-write quota.',
      },
    },
    onchainOS: {
      skillsInstall: 'npx skills add okx/onchainos-skills --yes -g',
      amberSkillPath: `${PUBLIC_BASE_URL}/skills/amber/SKILL.md`,
      x402Probe: `bash scripts/onchainos-x402-check.sh`,
      x402ProbeNote: 'onchainos payment pay parses the PAYMENT-REQUIRED header inline — no separate x402-check CLI command. Run the script above to verify eip155:196 + exact scheme are emitted correctly.',
      registerPrompt: 'Help me register an A2MCP ASP on OKX.AI using Onchain OS',
      listPrompt: 'Help me list my ASP on OKX.AI using Onchain OS',
      buyerDemo: [
        'Run finance_brief for my ERC-8004 identity on AMBER',
        'Use lifestyle_remember: I prefer dark mode and build agents on OKX.AI',
        'Who am I according to AMBER memory_whoami?',
        'What changed in my AMBER memory since yesterday?',
        'Show AMBER judging pack for Build X.',
      ],
    },
    generatedAt: new Date().toISOString(),
  });
};

// --- plugin ---------------------------------------------------------------

export const discoveryRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done
) => {
  app.get('/.well-known/x402', handleX402Manifest);
  app.get('/.well-known/amber', handleAmberManifest);
  app.get('/.well-known/mcp-clients.json', handleMcpClients);
  app.get('/onboarding.json', handleAmberManifest);
  app.get('/listing.json', handleListing);
  app.get('/mcp/discovery', handleMcpDiscovery);
  app.get('/skills/amber/SKILL.md', async (_req, reply) => {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const skillPath = resolve(here, '../../skills/amber/SKILL.md');
      const body = readFileSync(skillPath, 'utf8');
      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      reply.header('Cache-Control', 'public, max-age=300');
      return reply.code(200).send(body);
    } catch {
      return reply.code(404).send({ success: false, error: { message: 'skill not found' } });
    }
  });

  // /skills/amber/manifest.json — machine-readable capability manifest for
  // OpenClaw ClawHub, Hermes federated mesh, and Onchain OS auto-discovery.
  // Compact enough for skill-index crawlers to consume in one round-trip.
  app.get('/skills/amber/manifest.json', async (_req, reply) => {
    const base = PUBLIC_BASE_URL.replace(/\/+$/, '');
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.code(200).send({
      $schema: 'https://schemas.openclaw.dev/skill/v1.json',
      name: 'amber',
      version: pkg.version ?? '1.0.0',
      description:
        'Persistent memory-as-a-service for AI agents, keyed by ERC-8004 identity. Write once in Claude Code / OpenClaw / Hermes / Codex — recall in any MCP client. Merkle-attested on X Layer. Paid via x402 USDT.',
      author: 'amber-mcp',
      homepage: base,
      license: 'MIT',
      category: 'agent-state',
      tags: ['memory', 'identity', 'x402', 'xlayer', 'finance', 'lifestyle', 'attestation'],
      protocols: {
        mcp: {
          version: MCP_PROTOCOL_VERSION,
          endpoint: `${base}/mcp`,
          transport: 'streamable-http',
          capabilities: ['tools', 'resources', 'prompts', 'completion', 'logging'],
        },
        rest: {
          endpoint: base,
          docs: `${base}/docs`,
        },
        x402: {
          version: 2,
          scheme: 'exact',
          network: `eip155:${XLAYER_CHAIN_ID}`,
          asset: USDT_XLAYER_ADDRESS,
          manifest: `${base}/.well-known/x402`,
        },
      },
      supportedClients: ['claude-code', 'codex', 'openclaw', 'hermes', 'cursor'],
      installCommands: {
        openclaw: `npx skills add amber --skill-path ${base}/skills/amber/SKILL.md`,
        claudeCode: `claude mcp add amber --transport http ${base}/mcp`,
        hermes: `hermes mcp add amber ${base}/mcp`,
        cursor: `Add to mcpServers: { "amber": { "url": "${base}/mcp" } }`,
      },
      pricing: {
        freeTierWritesPerIdentity: 100,
        write: '0.001 USDT',
        query: '0.0005 USDT',
        related: '0.0005 USDT',
        sessionContext: '0.0002 USDT',
        seal: '0.05 USDT',
      },
      quickTools: [
        { name: 'memory_write', paid: false, note: 'free up to 100 per identity' },
        { name: 'memory_query', paid: true },
        { name: 'memory_related', paid: true, note: 'pgvector KNN from a seed memory' },
        { name: 'memory_template', paid: false, note: '5 OKX AI verticals: professional_asset, resume, creative, software, prediction' },
        { name: 'memory_whoami', paid: false },
        { name: 'finance_brief', paid: false, note: 'Finance Copilot with 24h PnL delta' },
        { name: 'lifestyle_remember', paid: false, note: 'Lifestyle Companion pin' },
      ],
      okxAiVerticals: [
        { vertical: 'professional_asset', description: 'Presentations, spreadsheets, reports, executive assets' },
        { vertical: 'resume', description: 'Resume + career workflows, ATS-ready outputs' },
        { vertical: 'creative', description: 'Brand design, text-to-asset, NFT-ready creative pipelines' },
        { vertical: 'software', description: 'App generation, DBs, data workflows, ML infra, agent training' },
        { vertical: 'prediction', description: 'Prediction-market execution, PnL history, conviction memory' },
      ],
      reputationLayer: {
        endpoint: `${base}/identity/reputation/{address}`,
        model: '0-100 score from persistence, verification, economic, breadth, deliberateness, longevity',
        tiers: ['unseen', 'fresh', 'active', 'established', 'trusted'],
        note: 'AMBER makes OKX AI\'s "persistent identity that accumulates reputation" thesis LIVE and QUERYABLE.',
      },
      productionReadyGate: `${base}/status/production-ready`,
      showcase: `${base}/public/showcase`,
      demo: {
        live: `${base}/demo/live`,
        perVertical: `${base}/demo/live/{vertical}`,
        forVertical: `${base}/demo/for-vertical/{vertical}`,
        replayScript: `${base}/demo/replay-script`,
        note: 'One URL per OKX AI vertical returns a realistic sample memory, recommended tool wiring, and cross-ASP integration path.',
      },
      comparables: {
        endpoint: `${base}/report/comparables`,
        against: ['Mem0', 'Zep', 'Letta'],
        thesis: 'AMBER does not compete on retrieval benchmarks — AMBER wins on OKX AI-native infrastructure (identity + reputation + payment + attestation).',
      },
      ogImages: {
        portraitCard: `${base}/portrait/{address}/card.png`,
        sealCard: `${base}/seal/{id}/card.png`,
        note: 'Twitter/OG-ready 1200×630 PNG cards with AMBER branding, live reputation score, and constellation art.',
      },
      ecosystemAlignment: {
        agenticWalletCompatible: true,
        openclawInstallable: true,
        openclawAgentTemplate: 'AMBER slots into the OKX OnchainOS Agent Template as the memory dependency.',
        onchainOsScale: '1.2B API calls/day, $300M trading volume (OKX Agent Trade Kit reference)',
      },
      onboarding: `${base}/.well-known/amber`,
      listing: `${base}/listing.json`,
      generatedAt: new Date().toISOString(),
    });
  });

  // Brand avatar for marketplace listing. 512×512 (1:1 required by OKX AI
  // marketplace). SVG is served as-is; PNG is rendered on demand via resvg.
  const AVATAR_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="AMBER">
  <defs>
    <radialGradient id="g" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#FBF7ED"/>
      <stop offset="55%" stop-color="#E4A853"/>
      <stop offset="100%" stop-color="#B86B2C"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="#1A1410"/>
  <circle cx="256" cy="256" r="168" fill="url(#g)"/>
  <circle cx="256" cy="256" r="54" fill="#1A1410" opacity="0.85"/>
  <text x="256" y="455" text-anchor="middle" font-family="Georgia, serif" font-size="42" fill="#E4A853" letter-spacing="6">AMBER</text>
</svg>`;

  const sendAvatarSvg = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.code(200).send(AVATAR_SVG);
  };

  // OKX AI marketplace requires an actual PNG file (uploaded via CLI). We
  // render one on demand so the endpoint always matches the current SVG
  // brand, and expose /assets/avatar.png for buyers/judges to inspect.
  let cachedPng: Buffer | null = null;
  const sendAvatarPng = async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!cachedPng) {
        // Lazy import — resvg is only needed here and in ogImageRenderer.
        const { renderSvgToPng } = await import('../services/ogImageRenderer.ts');
        cachedPng = renderSvgToPng(AVATAR_SVG, { width: 512, height: 512, background: '#1A1410' });
      }
      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'public, max-age=86400');
      reply.header('Content-Length', cachedPng.length.toString());
      return reply.code(200).send(cachedPng);
    } catch (err) {
      // Fallback to SVG when the renderer fails so the marketplace listing
      // never breaks. Content-Type stays SVG so browsers still render.
      console.warn('[discovery] avatar PNG render failed, falling back to SVG:', (err as Error).message);
      reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
      return reply.code(200).send(AVATAR_SVG);
    }
  };
  app.get('/assets/avatar.svg', sendAvatarSvg);
  app.get('/assets/avatar.png', sendAvatarPng);
  done();
};
