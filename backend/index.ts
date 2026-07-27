import './dotenv.ts';

import crypto from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import FastifyCors from '@fastify/cors';
import FastifyHelmet from '@fastify/helmet';
import FastifyRateLimit from '@fastify/rate-limit';
import FastifySwagger from '@fastify/swagger';
import FastifySwaggerUi from '@fastify/swagger-ui';

// Official OKX Payment SDK (x402). This is now the SOLE payment gate on the
// three paid memory routes (/memory/query, /memory/session-context,
// /memory/write). OKX verifies official-SDK integration by observing the
// verify/settle calls the OKXFacilitatorClient makes to its hosted facilitator.
// NOTE: ExactEvmScheme is imported from `@okxweb3/x402-evm/exact/server` — the
// SERVER-side, no-arg scheme implementing SchemeNetworkServer. The root
// `@okxweb3/x402-evm` export is the CLIENT/buyer scheme (needs a signer) and is
// NOT what x402ResourceServer.register() expects.
import { paymentMiddleware, x402ResourceServer } from '@okxweb3/x402-fastify';
import { ExactEvmScheme } from '@okxweb3/x402-evm/exact/server';
import { OKXFacilitatorClient } from '@okxweb3/x402-core';

import {
  APP_PORT,
  IS_DEV,
  validateConfig,
  OKX_API_KEY,
  OKX_SECRET_KEY,
  OKX_PASSPHRASE,
  ASP_WALLET_ADDRESS,
} from './src/config/main-config.ts';
import { redis } from './src/lib/redis.ts';
import { prismaQuery } from './src/lib/prisma.ts';

// Routes
import { memoryRoutes } from './src/routes/memoryRoutes.ts';
import { mcpRoutes } from './src/routes/mcpTransport.ts';
import { healthRoutes } from './src/routes/healthRoutes.ts';
import { adminRoutes } from './src/routes/adminRoutes.ts';
import { attestationRoutes } from './src/routes/attestationRoutes.ts';
import { identityRoutes } from './src/routes/identityRoutes.ts';
import { discoveryRoutes } from './src/routes/discoveryRoutes.ts';
import { subscriptionRoutes } from './src/routes/subscriptionRoutes.ts';
import { reportRoutes } from './src/routes/reportRoutes.ts';
import { sealRoutes } from './src/routes/sealRoutes.ts';
import { portraitRoutes } from './src/routes/portraitRoutes.ts';
import { socialRoutes } from './src/routes/socialRoutes.ts';
import { agentMetaRoutes } from './src/routes/agentMetaRoutes.ts';
import { analyticsRoutes } from './src/routes/analyticsRoutes.ts';
import { graphRoutes } from './src/routes/graphRoutes.ts';
import { publicRoutes } from './src/routes/publicRoutes.ts';
import { demoRoutes } from './src/routes/demoRoutes.ts';

// Workers
import { startErrorLogCleanupWorker } from './src/workers/errorLogCleanup.ts';
import { startAttestationBatcher } from './src/workers/attestationBatcher.ts';
import { startAttestationRetry } from './src/workers/attestationRetry.ts';
import { startUnattestedSweeper } from './src/workers/unattestedSweeper.ts';
import { startPaymentSettler } from './src/workers/paymentSettler.ts';

// Startup hook — verify on-chain USDT domain BEFORE accepting signatures.
import { initUsdtDomain } from './src/lib/xlayer/usdt.ts';

console.log(
  '======================\n======================\nAMBER BACKEND STARTED!\n======================\n======================\n'
);

// Fail fast on missing env vars (non-fatal in dev; validateConfig may exit).
validateConfig();

const fastify = Fastify({
  logger: { level: IS_DEV ? 'debug' : 'info' },
  genReqId: () => crypto.randomUUID(),
});

// Attach a stable request id header on every response so operators can
// grep logs by X-Request-Id when triaging incidents.
fastify.addHook('onSend', async (request, reply) => {
  reply.header('X-Request-Id', request.id as string);
});

// @fastify/helmet: adds HSTS, X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy and other secure defaults. CSP is disabled — we're an
// API and don't serve HTML, so a CSP would only add config drift.
fastify.register(FastifyHelmet, {
  contentSecurityPolicy: false,
});

// CORS trade-off:
//   /mcp routes are further constrained by originAllowlistMiddleware,
//   which enforces MCP_ALLOWED_ORIGINS regardless of what CORS lets
//   through here.
//   /memory/* is left open because the ASP is agent-only (no browser
//   callers) and OKX ecosystem agents may hit us from arbitrary origins.
//   Downgrade to an allowlist here if we ever add a browser client.
fastify.register(FastifyCors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'token',
    'PAYMENT-SIGNATURE',
    'APP-Access',
    'Accept',
    'MCP-Protocol-Version',
    'Mcp-Session-Id',
    'Origin',
  ],
  exposedHeaders: [
    'PAYMENT-REQUIRED',
    'PAYMENT-RESPONSE',
    'WWW-Authenticate',
    'Mcp-Session-Id',
    'MCP-Protocol-Version',
    'X-Amber-Replay',
    'X-Amber-Review',
    'X-Amber-Quota',
    'Retry-After',
  ],
});

// Global rate limiter — Redis-backed so limits are shared across replicas.
// Keyed on the first X-Forwarded-For entry when present (we sit behind a
// reverse proxy in production) and fall back to request.ip.
fastify.register(FastifyRateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
  redis,
  keyGenerator: (request) =>
    (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? request.ip,
  errorResponseBuilder: (_request, context) => ({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: `Rate limit exceeded. Retry after ${(context as { after: string }).after}`,
    },
    data: null,
  }),
});

// OpenAPI 3.0 spec — powers Swagger UI at /docs. Route schemas registered on
// individual handlers are aggregated automatically by @fastify/swagger.
fastify.register(FastifySwagger, {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'AMBER Memory API',
      description:
        'Persistent portable memory-as-a-service for AI agents. Keyed on ERC-8004 identity, x402 payment-gated, attested on X Layer blockchain.',
      version: '1.0.0',
    },
    servers: [
      { url: 'https://amber-mcp.xyz', description: 'Production' },
      { url: 'http://localhost:3700', description: 'Local' },
    ],
    tags: [
      { name: 'Memory', description: 'Write, query, and manage agent memories' },
      { name: 'Attestation', description: 'Merkle attestation on X Layer' },
      { name: 'Seal', description: 'SEALSCRIBE — AI decree wax seal generator' },
      { name: 'Portrait', description: 'Memory constellation portrait (SVG)' },
      { name: 'Identity', description: 'ERC-8004 identity stats' },
      { name: 'Health', description: 'Health and readiness' },
    ],
    components: {
      securitySchemes: {
        x402Payment: {
          type: 'apiKey' as const,
          in: 'header' as const,
          name: 'PAYMENT-SIGNATURE',
          description: 'EIP-3009 transferWithAuthorization for x402 micropayment',
        },
      },
    },
  },
});

fastify.register(FastifySwaggerUi, {
  routePrefix: '/docs',
  uiConfig: { docExpansion: 'list', deepLinking: true },
});

// Health check root
fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
  return reply.status(200).send({
    success: true,
    message: 'AMBER backend online. See /healthz for readiness.',
    error: null,
    data: {
      endpoints: [
        'POST /memory/write',
        'GET /memory/query',
        'POST /memory/bulk-write',
        'GET /memory/session-context',
        'GET /memory/list',
        'POST /memory/seed-wallet',
        'POST /memory/demo-pack',
        'POST /memory/whoami',
        'GET /memory/whoami',
        'POST /memory/diff',
        'POST /memory/pin',
        'POST /memory/share',
        'POST /memory/consolidate',
        'GET /memory/:id/attestation',
        'DELETE /memory/:memoryId',
        'POST /seal/generate',
        'GET /seal/:id',
        'GET /seal/:id.svg',
        'GET /portrait/:address.svg',
        'POST /mcp',
        'GET /admin/stats',
        'GET /admin/memory-report',
        'GET /agent.json',
        'GET /listing.json',
        'GET /.well-known/x402',
        'GET /.well-known/amber',
        'GET /onboarding.json',
        'GET /healthz',
        'GET /metrics',
        'GET /docs',
        'GET /social/card',
        'GET /social/badge.svg',
        'GET /report/daily',
        'GET /report/revenue',
        'GET /report/summary',
        'GET /report/judging',
        'GET /public/stats',
        'GET /public/leaderboard',
        'GET /public/payments',
        'GET /public/quickstart',
        'GET /skills/amber/SKILL.md',
        'GET /analytics/:address',
        'GET /graph/:address',
        'GET /agent.json',
        'GET /.well-known/agent.json',
        'GET /.well-known/amber',
        'GET /onboarding.json',
      ],
    },
  });
});

// Route registration
fastify.register(healthRoutes);
fastify.register(memoryRoutes, { prefix: '/memory' });
fastify.register(mcpRoutes, { prefix: '/mcp' });
fastify.register(adminRoutes, { prefix: '/admin' });
fastify.register(attestationRoutes, { prefix: '/attestation' });
fastify.register(identityRoutes, { prefix: '/identity' });
fastify.register(subscriptionRoutes, { prefix: '/subscription' });
fastify.register(reportRoutes, { prefix: '/report' });
fastify.register(sealRoutes, { prefix: '/seal' });
fastify.register(portraitRoutes, { prefix: '/portrait' });
fastify.register(socialRoutes, { prefix: '/social' });
// discoveryRoutes registers absolute paths (/.well-known/x402, /listing.json,
// /mcp/discovery). No prefix — these are top-level marketing surfaces.
fastify.register(discoveryRoutes);
// agentMetaRoutes serves /agent.json and /.well-known/agent.json (ERC-8004 v1
// ASP registration metadata for the OKX.AI marketplace).
fastify.register(agentMetaRoutes);
fastify.register(analyticsRoutes, { prefix: '/analytics' });
fastify.register(graphRoutes, { prefix: '/graph' });
// Public stats — minimal revenue counter for Revenue Rocket + Social Buzz evidence.
fastify.register(publicRoutes, { prefix: '/public' });

// Live judge/buyer demo — one-URL end-to-end proof + per-vertical samples.
fastify.register(demoRoutes, { prefix: '/demo' });

// -----------------------------------------------------------------------------
// Official OKX Payment SDK — x402 payment gate for the 3 paid memory routes.
//
// Mounted ONCE on the root instance. paymentMiddleware installs a GLOBAL
// onRequest hook (verify payment → emit a standard 402 + PAYMENT-REQUIRED
// header when unpaid) and an onSend hook (settle via the OKX facilitator after
// a <400 handler response). Non-matching routes fall straight through, so /mcp,
// free routes, attestation workers and /healthz are UNTOUCHED.
//
// Route keys are FULL paths (with the /memory prefix that memoryRoutes is
// registered under) and VERB-LESS, so the payment hook fires for ANY method —
// this is what makes a bodyless `curl -i -X POST /memory/query` and a paramless
// GET both return the standard 402 the OKX review harness probes for.
//
// syncFacilitatorOnStart defaults to true: the SDK calls the facilitator's
// getSupported() at boot to populate its supported-kinds map (required before it
// can build a 402). This call goes to https://web3.okx.com and will fail from a
// Cloudflare-WARP'd machine (403) — that is expected; the authoritative runtime
// check happens on the VPS after deploy. Do NOT disable syncFacilitatorOnStart.
const okxFacilitator = new OKXFacilitatorClient({
  apiKey: OKX_API_KEY!,
  secretKey: OKX_SECRET_KEY!,
  passphrase: OKX_PASSPHRASE!,
  // baseUrl defaults to https://web3.okx.com; syncSettle omitted (async settle).
});

const okxPaymentServer = new x402ResourceServer(okxFacilitator).register(
  'eip155:196',
  new ExactEvmScheme()
);

// price "$0.0005"/"$0.0002"/"$0.001" → amount 500/200/1000 atomic on USD₮0
// (0x779ded…, decimals 6) with flat extra {name:"USD₮0",version:"1"} — the SDK's
// getDefaultAsset("eip155:196") resolves these, byte-matching AMBER's existing
// challenge and config PRICE_*_ATOMIC.
paymentMiddleware(
  fastify,
  {
    '/memory/query': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:196',
        payTo: ASP_WALLET_ADDRESS,
        price: '$0.0005',
      },
      description: 'Memory recall',
      mimeType: 'application/json',
    },
    '/memory/session-context': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:196',
        payTo: ASP_WALLET_ADDRESS,
        price: '$0.0002',
      },
      description: 'Session context',
      mimeType: 'application/json',
    },
    '/memory/write': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:196',
        payTo: ASP_WALLET_ADDRESS,
        price: '$0.001',
      },
      description: 'Memory write',
      mimeType: 'application/json',
    },
  },
  okxPaymentServer
);

// Live operations snapshot — uptime, process memory, DB counts, and pending
// attestation queue depth. Read-only, best-effort. Safe to expose publicly
// because it exposes no PII or secrets; if that changes, gate behind
// ADMIN_API_TOKEN.
fastify.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  let identityCount = 0;
  let memoryCount = 0;
  let pendingAttestation = 0;
  let pendingQueue = -1;

  try {
    [identityCount, memoryCount, pendingAttestation] = await Promise.all([
      prismaQuery.identity.count(),
      prismaQuery.memory.count({ where: { deletedAt: null } }),
      prismaQuery.memory.count({ where: { deletedAt: null, attestationId: null } }),
    ]);
  } catch {
    /* best-effort */
  }

  try {
    pendingQueue = await redis.llen('pending:attestations');
  } catch {
    /* best-effort */
  }

  return reply.code(200).send({
    success: true,
    error: null,
    data: {
      uptime: Math.floor(uptime),
      uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
      db: { identities: identityCount, activeMemories: memoryCount, pendingAttestation },
      queue: { pendingAttestations: pendingQueue },
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
    },
  });
});

const start = async (): Promise<void> => {
  try {
    // Initialise USDT EIP-712 domain from chain (refuses to boot on failure
    // when SIGNER_MODE indicates production, else warns).
    try {
      await initUsdtDomain();
    } catch (err) {
      console.error('[startup] USDT domain init failed:', (err as Error).message);
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }

    // Workers
    startErrorLogCleanupWorker();
    startAttestationBatcher();
    startAttestationRetry();
    startUnattestedSweeper();
    startPaymentSettler();

    await fastify.listen({
      port: APP_PORT,
      host: '0.0.0.0',
    });

    const address = fastify.server.address();
    const port = typeof address === 'object' && address ? address.port : APP_PORT;

    console.log(`Server started successfully on port ${port}`);
    console.log(`http://localhost:${port}`);
  } catch (error) {
    console.log('Error starting server: ', error);
    process.exit(1);
  }
};

start();
