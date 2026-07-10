import { Redis } from 'ioredis';
import { REDIS_URL } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// Shared ioredis singleton
//
// Reuses the same pattern as prisma.ts — one shared client for the whole
// process. Lazy-connect so the module can be imported before the URL is set
// (validation happens in main-config validateConfig()).
//
// Namespaces (owner: various modules):
//   nonce:{hex}                       — x402 nonce dedupe, TTL 86400s
//   quota:free:{identity}             — free-tier counter mirror
//   rate:{identity}:{endpoint}        — rate limiter INCR/EXPIRE 60s
//   embed:{sha256(text)}              — 24h embedding cache
//   mcp:session:{sessionId}           — 1h MCP session hash
//   identity:{addr}                   — 24h ERC-8004 resolve cache
//   pending:attestations              — Redis LIST batched by worker
// -----------------------------------------------------------------------------

let client: Redis | null = null;

const buildClient = (): Redis => {
  const r = new Redis(REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    reconnectOnError: (err: Error) => {
      const targetErrors = ['READONLY', 'ETIMEDOUT'];
      return targetErrors.some((code) => err.message.includes(code));
    },
  });

  r.on('error', (err: Error) => {
    // Do not log the URL (contains credentials on Upstash).
    console.error('[redis] error:', err.message);
  });

  r.on('connect', () => {
    console.log('[redis] connected');
  });

  return r;
};

export const redis: Redis = ((): Redis => {
  if (client) return client;
  client = buildClient();
  return client;
})();

export const redisHealthy = async (): Promise<boolean> => {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
};
