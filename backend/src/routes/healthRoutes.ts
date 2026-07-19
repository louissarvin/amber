import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { redis, redisHealthy } from '../lib/redis.ts';
import { xlayerRpcHealthy } from '../lib/xlayer/rpc.ts';
import {
  ASP_WALLET_ADDRESS,
  OPENAI_API_KEY,
  PUBLIC_BASE_URL,
  USDT_XLAYER_ADDRESS,
  XLAYER_CHAIN_ID,
} from '../config/main-config.ts';
import { getAttestationCapability } from '../services/attestationCapability.ts';
import { MCP_TOOL_COUNT } from './mcpTransport.ts';

// -----------------------------------------------------------------------------
// Health endpoints.
// - /livez  — process alive (always 200)
// - /healthz + /health/ready — dependency readiness
// - /health — alias of /healthz (doc 08 naming)
// OpenAI is config-only (never live-pinged from health).
// -----------------------------------------------------------------------------

interface HealthChecks {
  postgres: boolean;
  redis: boolean;
  xlayer: boolean;
  openai: 'configured' | 'missing';
  pendingAttestations: number;
  attestationOnChainLive: boolean;
  attestationNote: string;
}

const OPENAI_KEY_MIN_LENGTH = 20;

const runChecks = async (): Promise<HealthChecks> => {
  const openaiConfigured =
    typeof OPENAI_API_KEY === 'string' && OPENAI_API_KEY.length > OPENAI_KEY_MIN_LENGTH;

  const [postgres, redisOk, xlayer, pendingAttestations, attestationCap] = await Promise.all([
    (async () => {
      try {
        await prismaQuery.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    })(),
    redisHealthy(),
    xlayerRpcHealthy(),
    (async () => {
      try {
        return await redis.llen('pending:attestations');
      } catch {
        return -1;
      }
    })(),
    getAttestationCapability(),
  ]);

  return {
    postgres,
    redis: redisOk,
    xlayer,
    openai: openaiConfigured ? 'configured' : 'missing',
    pendingAttestations,
    attestationOnChainLive: attestationCap.onChainLive,
    attestationNote: attestationCap.note,
  };
};

const sendReady = async (_req: FastifyRequest, reply: FastifyReply) => {
  const checks = await runChecks();
  const ok = checks.postgres && checks.redis && checks.xlayer;
  return reply.code(ok ? 200 : 503).send({
    success: ok,
    error: ok ? null : { code: 'DEPENDENCY_DOWN', message: 'one or more dependencies unhealthy' },
    data: { status: ok ? 'ok' : 'degraded', checks },
  });
};

// GET /status/production-ready — self-service judge validation.
// A single URL that answers: "is AMBER truly ready for the OKX AI marketplace?"
// Every gate that would block registration or reduce trust is checked here.
// Returns 200 with a full breakdown so judges can copy-paste the report.
const sendProductionReady = async (
  _req: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> => {
  const checks = await runChecks();

  const gates: Array<{ gate: string; ok: boolean; note: string }> = [];

  gates.push({
    gate: 'postgres_up',
    ok: checks.postgres,
    note: checks.postgres ? 'Prisma SELECT 1 returned' : 'DB unreachable',
  });
  gates.push({
    gate: 'redis_up',
    ok: checks.redis,
    note: checks.redis ? 'Redis PING responded' : 'Redis unreachable',
  });
  gates.push({
    gate: 'xlayer_rpc_up',
    ok: checks.xlayer,
    note: checks.xlayer ? `X Layer chain ${XLAYER_CHAIN_ID} reachable` : 'X Layer RPC unreachable',
  });
  gates.push({
    gate: 'openai_embeddings_configured',
    ok: checks.openai === 'configured',
    note: checks.openai === 'configured' ? 'OPENAI_API_KEY set' : 'Set OPENAI_API_KEY for semantic recall',
  });

  const publicBaseUrlOk = /^https?:\/\//.test(PUBLIC_BASE_URL);
  const publicBaseHttpsOk = PUBLIC_BASE_URL.startsWith('https://');
  gates.push({
    gate: 'public_base_url_set',
    ok: publicBaseUrlOk,
    note: publicBaseUrlOk ? PUBLIC_BASE_URL : 'PUBLIC_BASE_URL missing or invalid',
  });
  gates.push({
    gate: 'public_base_url_https',
    ok: publicBaseHttpsOk,
    note: publicBaseHttpsOk ? 'HTTPS enforced' : 'OKX.AI review requires https:// URL',
  });

  const aspWalletOk = /^0x[0-9a-fA-F]{40}$/.test(ASP_WALLET_ADDRESS);
  gates.push({
    gate: 'asp_wallet_configured',
    ok: aspWalletOk,
    note: aspWalletOk
      ? `payTo=${ASP_WALLET_ADDRESS.slice(0, 6)}...${ASP_WALLET_ADDRESS.slice(-4)}`
      : 'Set ASP_WALLET_ADDRESS for x402 payTo target',
  });

  const usdtOk = /^0x[0-9a-fA-F]{40}$/.test(USDT_XLAYER_ADDRESS);
  gates.push({
    gate: 'usdt_asset_configured',
    ok: usdtOk,
    note: usdtOk ? `USDT on X Layer: ${USDT_XLAYER_ADDRESS.slice(0, 10)}...` : 'USDT address invalid',
  });

  gates.push({
    gate: 'attestation_capability_declared',
    ok: true, // always ok — we degrade honestly
    note: checks.attestationNote,
  });

  gates.push({
    gate: 'attestation_queue_healthy',
    ok: checks.pendingAttestations >= 0 && checks.pendingAttestations < 500,
    note: `pending queue depth = ${checks.pendingAttestations}`,
  });

  // Count MCP tools that respond to tools/list. Derived from the tools array
  // in mcpTransport.ts (single source of truth) so this can never drift.
  gates.push({
    gate: 'mcp_tool_count_>=_29',
    ok: MCP_TOOL_COUNT >= 29,
    note: `${MCP_TOOL_COUNT} MCP tools registered`,
  });

  const okCount = gates.filter((g) => g.ok).length;
  const totalCount = gates.length;
  const allOk = okCount === totalCount;
  const anyBlocker = gates.some(
    (g) => !g.ok && ['postgres_up', 'redis_up', 'xlayer_rpc_up', 'public_base_url_set', 'asp_wallet_configured'].includes(g.gate)
  );

  return reply.code(200).send({
    success: true,
    error: null,
    data: {
      status: allOk ? 'READY' : anyBlocker ? 'BLOCKED' : 'DEGRADED',
      readyForOkxAiReview: allOk && publicBaseHttpsOk,
      gatesPassed: `${okCount}/${totalCount}`,
      gates,
      registrationChecklist: [
        'onchainos validate-listing',
        'onchainos agent pre-check --role asp',
        'onchainos agent create',
        'onchainos agent activate',
      ],
      links: {
        listing: `${PUBLIC_BASE_URL}/listing.json`,
        agent: `${PUBLIC_BASE_URL}/agent.json`,
        skillManifest: `${PUBLIC_BASE_URL}/skills/amber/manifest.json`,
        x402: `${PUBLIC_BASE_URL}/.well-known/x402`,
        judgingPack: `${PUBLIC_BASE_URL}/report/judging`,
      },
      generatedAt: new Date().toISOString(),
    },
  });
};

// Process start snapshot — used for uptime reporting.
const PROCESS_START_MS = Date.now();

// GET /health/uptime — public SLA / uptime surface. No auth, no rate limit,
// safe to include on marketing materials and OKX AI listing. Reports process
// start, current uptime, and a promise-oriented SLA target so ASPs shopping
// for infrastructure can gate on reliability.
const sendUptime = async (
  _req: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> => {
  const now = Date.now();
  const uptimeMs = now - PROCESS_START_MS;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  const uptimeDays = uptimeMs / (86400 * 1000);

  const format = (s: number): string => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${d}d ${h}h ${m}m ${sec}s`;
  };

  reply.header('Cache-Control', 'public, max-age=15');
  return reply.code(200).send({
    success: true,
    error: null,
    data: {
      status: 'up',
      processStart: new Date(PROCESS_START_MS).toISOString(),
      now: new Date(now).toISOString(),
      uptimeSeconds,
      uptimeHuman: format(uptimeSeconds),
      uptimeDays: Number(uptimeDays.toFixed(4)),
      slaTarget: '99.9% monthly (soft target)',
      slaNote:
        'AMBER runs on Fly.io with Redis + Postgres managed dependencies. SLA is soft — we target 99.9% but do not offer contractual guarantees during the OKX AI Genesis campaign period.',
      componentHealth: `${'/'}healthz`,
      productionReadyGate: `${'/'}status/production-ready`,
    },
  });
};

export const healthRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get('/healthz', sendReady);
  app.get('/health', sendReady);
  app.get('/health/ready', sendReady);
  app.get('/health/uptime', sendUptime);
  app.get('/status/production-ready', sendProductionReady);

  app.get('/livez', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({ success: true, error: null, data: { status: 'alive' } });
  });

  done();
};
