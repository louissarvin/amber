import crypto from 'node:crypto';
import OpenAI from 'openai';
import { redis } from '../redis.ts';
import {
  OPENAI_API_KEY,
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
} from '../../config/main-config.ts';

// -----------------------------------------------------------------------------
// OpenAI embeddings
//
// Model:      text-embedding-3-small
// Dimensions: 1024 (Matryoshka truncation — matches pgvector column)
// Cache:      Redis `embed:{sha256(text)}` for 24h + a tiny in-memory LRU (500)
//
// Rate-limit backoff:
//   3 attempts, exponential delay (500ms, 1s, 2s). Bubbles the last error.
// -----------------------------------------------------------------------------

const EMBED_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h
const LRU_MAX = 500;
const RETRY_ATTEMPTS = 3;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Small in-process LRU on the hot path.
const memoryCache = new Map<string, number[]>();

const rememberLocal = (key: string, value: number[]): void => {
  if (memoryCache.has(key)) memoryCache.delete(key);
  memoryCache.set(key, value);
  if (memoryCache.size > LRU_MAX) {
    const first = memoryCache.keys().next().value;
    if (first !== undefined) memoryCache.delete(first);
  }
};

const cacheKey = (text: string): string => {
  const h = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  return `embed:${OPENAI_EMBEDDING_MODEL}:${OPENAI_EMBEDDING_DIMENSIONS}:${h}`;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const requestEmbedding = async (text: string): Promise<number[]> => {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await openai.embeddings.create({
        model: OPENAI_EMBEDDING_MODEL,
        input: text,
        dimensions: OPENAI_EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      });
      const vec = res.data[0]?.embedding;
      if (!Array.isArray(vec) || vec.length !== OPENAI_EMBEDDING_DIMENSIONS) {
        throw new Error(`unexpected embedding shape from OpenAI: length=${vec?.length}`);
      }
      return vec;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      // Only backoff on 429 / 5xx; propagate 4xx immediately.
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt < RETRY_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
};

export const embed = async (text: string): Promise<number[]> => {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('embed(): text must be a non-empty string');
  }

  // Local smoke only — deterministic pseudo-embeddings so db/API tests run
  // without calling OpenAI. Never enable in production.
  if (process.env.EMBED_FAKE === 'true') {
    const h = crypto.createHash('sha256').update(text, 'utf8').digest();
    const vec = new Array<number>(OPENAI_EMBEDDING_DIMENSIONS);
    for (let i = 0; i < OPENAI_EMBEDDING_DIMENSIONS; i++) {
      vec[i] = ((h[i % h.length] ?? 0) / 255) * 2 - 1;
    }
    return vec;
  }

  const key = cacheKey(text);

  const local = memoryCache.get(key);
  if (local) return local;

  try {
    const raw = await redis.get(key);
    if (raw) {
      const parsed = JSON.parse(raw) as number[];
      if (Array.isArray(parsed) && parsed.length === OPENAI_EMBEDDING_DIMENSIONS) {
        rememberLocal(key, parsed);
        return parsed;
      }
    }
  } catch (err) {
    // Cache read failure must not block the write. Log and continue.
    console.warn('[embeddings] redis cache read failed:', (err as Error).message);
  }

  const vec = await requestEmbedding(text);

  rememberLocal(key, vec);
  redis
    .set(key, JSON.stringify(vec), 'EX', EMBED_CACHE_TTL_SECONDS)
    .catch((err: Error) => {
      console.warn('[embeddings] redis cache write failed:', err.message);
    });

  return vec;
};

// openAiPing() was removed intentionally — health checks must not incur a
// per-probe OpenAI cost, and service liveness must not depend on a
// third-party API. See src/routes/healthRoutes.ts for the config-only
// assertion that replaced it.
