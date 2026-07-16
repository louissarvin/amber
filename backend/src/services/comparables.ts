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
