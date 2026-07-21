// GET /agent.json — ERC-8004 v1 ASP registration metadata
// Required for OKX.AI marketplace listing and ASP discovery.
//
// Also served at /.well-known/agent.json (RFC 8615 well-known location).
// Values are pulled from main-config so a redeploy with a different chain,
// wallet, or registry does not require a code change.

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import {
  ASP_WALLET_ADDRESS,
  ERC8004_REGISTRY_ADDRESS,
  PUBLIC_BASE_URL,
  USDT_XLAYER_ADDRESS,
  XLAYER_CHAIN_ID,
} from '../config/main-config.ts';

interface AgentJsonResponse {
  $schema: string;
  name: string;
  version: string;
  description: string;
  category: string;
  capabilities: string[];
  x402Support: boolean;
  supportedTrust: string[];
  supportedSchemes: string[];
  active: boolean;
  globalIdFormat: string;
  services: Array<Record<string, unknown>>;
  payment: {
    asset: string;
    network: string;
    schemes: string[];
    priceRange: { min: string; max: string; unit: string };
  };
  identity: {
    erc8004Registry: string;
    chainId: number;
    aspWallet: string;
  };
  links: Record<string, string>;
  generatedAt: string;
}

const buildAgentJson = (): AgentJsonResponse => {
  const base = PUBLIC_BASE_URL.replace(/\/+$/, '');
  return {
    $schema: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'AMBER',
    version: '1.0.0',
    description:
      'AMBER treats your ERC-8004 identity as the primary key of a persistent agent state store — not just a marketplace discovery record. Write once, recall across Claude Code / Codex / any MCP client. Merkle-attested on X Layer. SEALSCRIBE + Memory Portrait included.',
    category: 'Software Utility',
    capabilities: [
      'memory',
      'attestation',
      'sealscribe',
      'portrait',
      'x402',
      'portfolio',
      'finance-copilot',
      'lifestyle-companion',
      'analytics',
      'graph',
      'share',
      'dossier',
    ],
    x402Support: true,
    // ERC-8004 v1 agentURI `supportedTrust` values (verified against
    // https://eips.ethereum.org/EIPS/eip-8004):
    //   - reputation: on-chain feedback via Reputation Registry
    //   - crypto-economic: bond / stake / payment settlement guarantees
    //   - tee-attestation: TEE-signed responses from OKX Onchain OS
    // AMBER covers all three because paid calls settle through OKX Agentic
    // Wallet TEE (SIGNER_MODE=tee) when configured.
    supportedTrust: ['reputation', 'crypto-economic', 'tee-attestation'],
    supportedSchemes: ['exact', 'period'],
    active: true,
    // ERC-8004 v1 global ID format for cross-chain identity linking:
    //   {namespace}:{chainId}:{identityRegistry}:{agentId}
    // e.g., eip155:196:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:{agentId}
    // We omit the agentId until the ASP has actually registered — the field
    // is populated by env var so a redeploy after `agent create` picks it up.
    globalIdFormat: `eip155:${XLAYER_CHAIN_ID}:${ERC8004_REGISTRY_ADDRESS}:{agentId}`,
    services: [
      {
        name: 'MCP',
        type: 'A2MCP',
        endpoint: `${base}/mcp`,
        protocolVersion: '2025-06-18',
        tools: [
          'memory_write',
          'memory_query',
          'memory_bulk_write',
          'memory_session_context',
          'memory_list',
          'memory_get',
          'memory_delete',
          'memory_seed_wallet',
          'memory_verify_attestation',
          'memory_share',
          'memory_consolidate',
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
      },
      {
        name: 'REST',
        type: 'HTTP',
        endpoint: base,
        docsUrl: `${base}/docs`,
      },
    ],
    payment: {
      asset: USDT_XLAYER_ADDRESS,
      network: `eip155:${XLAYER_CHAIN_ID}`,
      schemes: ['exact'],
      priceRange: { min: '1', max: '50000', unit: 'atomic' },
    },
    identity: {
      erc8004Registry: ERC8004_REGISTRY_ADDRESS,
      chainId: XLAYER_CHAIN_ID,
      aspWallet: ASP_WALLET_ADDRESS,
    },
    links: {
      docs: `${base}/docs`,
      listing: `${base}/listing.json`,
      agent: `${base}/agent.json`,
      x402: `${base}/.well-known/x402`,
      amber: `${base}/.well-known/amber`,
      portrait: `${base}/portrait`,
      social: `${base}/social/card`,
      badge: `${base}/social/badge.svg`,
      revenue: `${base}/report/revenue`,
      judging: `${base}/report/judging`,
      publicStats: `${base}/public/stats`,
      publicPayments: `${base}/public/payments`,
      mcpClients: `${base}/.well-known/mcp-clients.json`,
      skillManifest: `${base}/skills/amber/manifest.json`,
      payerLeaderboard: `${base}/report/payers`,
      showcase: `${base}/public/showcase`,
      reputation: `${base}/identity/reputation/{address}`,
      productionReady: `${base}/status/production-ready`,
      demoLive: `${base}/demo/live`,
      demoForVertical: `${base}/demo/for-vertical/{vertical}`,
      demoReplayScript: `${base}/demo/replay-script`,
      comparables: `${base}/report/comparables`,
      portraitCardPng: `${base}/portrait/{address}/card.png`,
      sealCardPng: `${base}/seal/{id}/card.png`,
      avatar: `${base}/assets/avatar.svg`,
    },
    generatedAt: new Date().toISOString(),
  };
};

const sendAgentJson = async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
  const body = buildAgentJson();
  reply.header('Content-Type', 'application/json; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=300');
  return reply.code(200).send(body);
};

export const agentMetaRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done
) => {
  app.get('/agent.json', sendAgentJson);
  app.get('/.well-known/agent.json', sendAgentJson);
  done();
};
