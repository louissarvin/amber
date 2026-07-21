import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import { PUBLIC_BASE_URL } from '../config/main-config.ts';
import { AmberErrorCodes, handleBadInput, handleError } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// Memory Analytics — public per-identity JSON dashboard.
//
// Free, no payment, cached in Redis for 120s. All queries are parameterised
// with `$1` bindings and never touch the pgvector `embedding` column (that
// row would be huge and useless for aggregation).
// -----------------------------------------------------------------------------

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 120;

interface CategoryRow {
  category: string;
  count: number;
}
interface TimelineRow {
  day: Date | string;
  count: number;
}
interface TagRow {
  tag: string;
  count: number;
}
interface AttestedRow {
  attested: number;
}
interface SharedInRow {
  count: number;
}
interface SharedOutRow {
  count: number;
}

interface AnalyticsPayload {
  address: string;
  totalMemories: number;
  categoryBreakdown: Array<{ category: string; count: number }>;
  dailyTimeline: Array<{ day: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
  attestedCount: number;
  pendingAttestation: number;
  sealCount: number;
  sharedIn: number;
  sharedOut: number;
  portraitUrl: string;
  generatedAt: string;
}

const dayKey = (day: Date | string): string => {
  if (day instanceof Date) return day.toISOString().slice(0, 10);
  // Postgres may return day as a string when the driver skips date parsing.
  const parsed = new Date(day);
  return Number.isNaN(parsed.getTime()) ? String(day).slice(0, 10) : parsed.toISOString().slice(0, 10);
};

export const buildAnalytics = async (address: string): Promise<AnalyticsPayload> => {
  const lower = address.toLowerCase();

  const identity = await prismaQuery.identity.findFirst({
    where: { address: lower },
    select: { id: true },
  });

  if (!identity) {
    return {
      address: lower,
      totalMemories: 0,
      categoryBreakdown: [],
      dailyTimeline: [],
      topTags: [],
      attestedCount: 0,
      pendingAttestation: 0,
      sealCount: 0,
      sharedIn: 0,
      sharedOut: 0,
      portraitUrl: `${PUBLIC_BASE_URL}/portrait/${lower}.svg`,
      generatedAt: new Date().toISOString(),
    };
  }

  const [
    categoryRows,
    timelineRows,
    tagRows,
    attestedRows,
    totalMemories,
    sealCount,
    sharedInRows,
    sharedOutRows,
  ] = await Promise.all([
    prismaQuery.$queryRawUnsafe<CategoryRow[]>(
      `SELECT category::text AS category, COUNT(*)::int AS count
         FROM "Memory"
        WHERE "identityId" = $1 AND "deletedAt" IS NULL
        GROUP BY category
        ORDER BY count DESC`,
      identity.id
    ),
    prismaQuery.$queryRawUnsafe<TimelineRow[]>(
      `SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::int AS count
         FROM "Memory"
        WHERE "identityId" = $1 AND "deletedAt" IS NULL
          AND "createdAt" >= NOW() - INTERVAL '7 days'
        GROUP BY day
        ORDER BY day ASC`,
      identity.id
    ),
    prismaQuery.$queryRawUnsafe<TagRow[]>(
      `SELECT UNNEST(tags) AS tag, COUNT(*)::int AS count
         FROM "Memory"
        WHERE "identityId" = $1 AND "deletedAt" IS NULL
        GROUP BY tag
        ORDER BY count DESC
        LIMIT 10`,
      identity.id
    ),
    prismaQuery.$queryRawUnsafe<AttestedRow[]>(
      `SELECT COUNT(*)::int AS attested
         FROM "Memory" m
        WHERE m."identityId" = $1 AND m."deletedAt" IS NULL AND m."attestationId" IS NOT NULL`,
      identity.id
    ),
    prismaQuery.memory.count({ where: { identityId: identity.id, deletedAt: null } }),
    prismaQuery.seal.count({ where: { identityId: identity.id, deletedAt: null } }),
    // Shared IN: memories on THIS identity that were copied from someone else.
    prismaQuery.$queryRawUnsafe<SharedInRow[]>(
      `SELECT COUNT(*)::int AS count
         FROM "Memory"
        WHERE "identityId" = $1
          AND "deletedAt" IS NULL
          AND 'shared' = ANY(tags)`,
      identity.id
    ),
    // Shared OUT: memories on OTHER identities whose metadata.sharedFrom = this address.
    prismaQuery.$queryRawUnsafe<SharedOutRow[]>(
      `SELECT COUNT(*)::int AS count
         FROM "Memory"
        WHERE "deletedAt" IS NULL
          AND metadata ->> 'sharedFrom' = $1`,
      lower
    ),
  ]);

  const attestedCount = attestedRows[0]?.attested ?? 0;
  const pendingAttestation = Math.max(0, totalMemories - attestedCount);

  return {
    address: lower,
    totalMemories,
    categoryBreakdown: categoryRows.map((r) => ({
      category: r.category,
      count: Number(r.count),
    })),
    dailyTimeline: timelineRows.map((r) => ({
      day: dayKey(r.day),
      count: Number(r.count),
    })),
    topTags: tagRows.map((r) => ({ tag: r.tag, count: Number(r.count) })),
    attestedCount,
    pendingAttestation,
    sealCount,
    sharedIn: sharedInRows[0]?.count ?? 0,
    sharedOut: sharedOutRows[0]?.count ?? 0,
    portraitUrl: `${PUBLIC_BASE_URL}/portrait/${lower}.svg`,
    generatedAt: new Date().toISOString(),
  };
};

const handleGetAnalytics = async (
  request: FastifyRequest<{ Params: { address: string } }>,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { address } = request.params;
  if (!ADDRESS_REGEX.test(address)) {
    return handleBadInput(reply, 'address must be a valid 0x + 40 hex ERC-8004 identity');
  }
  const lower = address.toLowerCase();

  const cacheKey = `analytics:${lower}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Analytics-Cache', 'HIT');
      return reply.code(200).send({ success: true, error: null, data: JSON.parse(cached) });
    }
  } catch (err) {
    console.warn('[analytics] redis get failed, computing fresh:', (err as Error).message);
  }

  try {
    const data = await buildAnalytics(lower);
    // Best-effort cache — do not block on Redis failure.
    redis
      .set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL_SECONDS)
      .catch((err: Error) => {
        console.warn('[analytics] redis cache set failed:', err.message);
      });
    reply.header('X-Amber-Analytics-Cache', 'MISS');
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    return handleError(
      reply,
      500,
      'analytics generation failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

export const analyticsRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get('/:address', handleGetAnalytics);
  done();
};
