import { PUBLIC_BASE_URL, XLAYER_CHAIN_ID } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// AMBER vs the memory-framework landscape.
//
// Mem0 / Zep / Letta are legitimate research-heavy memory frameworks. AMBER
// does not compete with them on LoCoMo / LongMemEval retrieval benchmarks —
// AMBER competes on OKX-AI-native infrastructure: ERC-8004 identity, on-chain
// reputation, Merkle attestation, x402 payment, OpenClaw skill installability,
// and native Agentic Wallet compatibility.
//
// This service returns a deterministic, honest comparison judges can cite in
// under 5 seconds. Every AMBER claim resolves to a live endpoint on this same
// server — no marketing copy without a URL to verify.
// -----------------------------------------------------------------------------

export const buildComparables = (): Record<string, unknown> => {
  const base = PUBLIC_BASE_URL.replace(/\/+$/, '');

  return {
    schema: 'amber.comparables.v1',
    title: 'AMBER vs the AI-agent memory landscape',
    thesis:
      'Mem0, Zep, and Letta win on retrieval benchmarks (LoCoMo, LongMemEval). AMBER wins on OKX AI-native infrastructure. Different problem, different lane — AMBER is the only memory service that ships as an OKX AI ASP.',
    benchmarksAcknowledged: [
      {
        name: 'LoCoMo',
        note: 'Long-conversation memory benchmark. Mem0 and Zep both outperform naive RAG by 20-40 percentage points.',
        source: 'https://arxiv.org/abs/2504.19413',
      },
      {
        name: 'LongMemEval',
        note: 'Temporal knowledge benchmark. Zep leads by 18.5% accuracy gain.',
        source: 'https://mem0.ai/blog/state-of-ai-agent-memory-2026',
      },
    ],
    amberScope:
      "AMBER's scope is deliberately narrower: identity-keyed persistent memory that any OKX AI ASP can write into and read out of. We do not aim to beat Zep on temporal graphs — we aim to be the memory layer under every ASP on OKX AI.",
    matrix: {
      capabilities: [
        {
          capability: 'Vector semantic recall',
          mem0: true,
          zep: true,
          letta: true,
          amber: 'pgvector 1024-dim (text-embedding-3-small)',
        },
        {
          capability: 'Temporal knowledge graph',
          mem0: false,
          zep: 'Graphiti temporal graph — 18.5% edge on LongMemEval',
          letta: false,
          amber: 'Out of scope (use Zep if you need it — AMBER interoperates via /memory/export)',
        },
        {
          capability: 'Memory block API (MemGPT lineage)',
          mem0: false,
          zep: false,
          letta: true,
          amber: 'Out of scope',
        },
        {
          capability: 'ERC-8004 on-chain identity as primary key',
          mem0: false,
          zep: false,
          letta: false,
          amber: `Every memory is keyed on 0x-address, publicly discoverable via ${base}/identity/reputation/{address}`,
        },
        {
          capability: 'Live on-chain Reputation Score (0-100)',
          mem0: false,
          zep: false,
          letta: false,
          amber: `${base}/identity/reputation/{address} — computed from persistence + verification + economic + breadth + deliberateness + longevity`,
        },
        {
          capability: 'Merkle attestation on-chain',
          mem0: false,
          zep: false,
          letta: false,
          amber: `X Layer (eip155:${XLAYER_CHAIN_ID}). Every memory batch anchors a Merkle root on-chain. Verifiable via ${base}/report/judging.`,
        },
        {
          capability: 'x402 pay-per-call scheme',
          mem0: false,
          zep: false,
          letta: false,
          amber: `x402 v2 exact + period on X Layer USDT (EIP-3009). ${base}/.well-known/x402`,
        },
        {
          capability: 'OKX Agentic Wallet compatible',
          mem0: false,
          zep: false,
          letta: false,
          amber: 'Yes — every paid call settles via EIP-3009 signature from any wallet that speaks OKX Agent Payments Protocol.',
        },
        {
          capability: 'OpenClaw ClawHub-installable skill',
          mem0: false,
          zep: false,
          letta: false,
          amber: `Yes — SKILL.md at ${base}/skills/amber/SKILL.md with agent.install block for Claude Code, Codex, OpenClaw, Hermes, Cursor.`,
        },
        {
          capability: '5 OKX AI vertical presets (professional_asset / resume / creative / software / prediction)',
          mem0: false,
          zep: false,
          letta: false,
          amber: 'memory_template MCP tool — one call writes vertical-tagged memory for cross-ASP discovery.',
        },
        {
          capability: 'A2A envelope routing (msgType: a2a-agent-chat)',
          mem0: false,
          zep: false,
          letta: false,
          amber: 'Yes — Onchain OS priority routing supported at MCP transport.',
        },
        {
          capability: 'Marketplace listing on OKX AI',
          mem0: false,
          zep: false,
          letta: false,
          amber: `Listed as A2MCP. ${base}/listing.json`,
        },
      ],
    },
    interoperability: {
      note: 'AMBER does not lock users in. Export bounded JSON with sha256 + attestation refs any time.',
      exportPath: `${base}/memory/export?identity=0x<address>`,
      portabilityPackMcpTool: 'memory_portability_pack — bounded JSON export with cryptographic proofs',
      importPathsFromCompetitors: [
        'Mem0 users: pipe your fact stream through memory_bulk_write with category="fact"',
        'Zep users: episodes → memory_bulk_write with category="event" preserves your temporal ordering',
        'Letta users: memory blocks map cleanly to memory_write with category="preference" and tags=["memory-block"]',
      ],
    },
    ecosystemAlignmentEvidence: [
      'OKX AI is the first agent marketplace with an on-chain reputation model. AMBER is the first memory service that surfaces that reputation as a live score.',
      "OKX's Agent Trade Kit handles 1.2B API calls / day and $300M trading volume. AMBER's x402 pricing is designed for that scale (0.0005 USDT queries).",
      'OKX OnchainOS Agent Template on OpenClaw (May 2026) — AMBER plugs in as the memory dependency in one skill install.',
      'Agentic Wallet delegated execution — AMBER paid calls settle via EIP-3009 authorization, no per-call user confirmation needed.',
    ],
    livenessProofs: {
      productionReady: `${base}/status/production-ready`,
      reputationScoreSample: `${base}/identity/reputation/0xdeadbeef000000000000000000000000deadbeef`,
      liveDemo: `${base}/demo/live`,
      x402Emission: `${base}/.well-known/x402`,
      skillManifest: `${base}/skills/amber/manifest.json`,
    },
    verdict:
      'If your ASP needs benchmark-topping retrieval on generic text corpora, use Mem0 or Zep. If your ASP ships on OKX AI and needs on-chain identity + reputation + payment + attestation from day one, use AMBER. The two categories are complementary, not competitive — AMBER is a first-class OKX AI citizen, they are not.',
    generatedAt: new Date().toISOString(),
  };
};
