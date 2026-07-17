import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import { renderPortraitSvg } from '../lib/portrait/svgRenderer.ts';

// -----------------------------------------------------------------------------
// Memory Portrait service
//
// Renders a per-identity radial SVG constellation from the 32 most-recent
// active memories. Cached in Redis (TTL 300s) to keep GETs cheap and
// invalidated by bustPortraitCache() on any memory write for the address.
//
// pgvector note: the Memory model has an `embedding vector(1024)` column that
// Prisma cannot select via the ORM (Unsupported type). We use $queryRawUnsafe
// and explicitly list every column EXCEPT embedding.
// -----------------------------------------------------------------------------

const PORTRAIT_CACHE_TTL_SECONDS = 300;
const PORTRAIT_MEMORY_LIMIT = 32;
// Timelapse renders more of the lifetime than the classic 32-node view. The
// per-hub cap (24) in the renderer still bounds visual clutter.
const PORTRAIT_TIMELAPSE_LIMIT = 64;

// Inclusive bounds for the ?frames=N query param. Exported so the route layer
// validates against the same single source of truth.
export const TIMELAPSE_MIN_FRAMES = 2;
export const TIMELAPSE_MAX_FRAMES = 12;

const cacheKey = (address: string): string => `portrait:svg:${address}`;
const timelapseCacheKey = (address: string, frames: number): string =>
  `${cacheKey(address)}:f${frames}`;

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  tags: string[];
}

interface TimelapseRow extends MemoryRow {
  createdAt: Date;
}

const generateFresh = async (address: string): Promise<string | null> => {
  const identity = await prismaQuery.identity.findFirst({
    where: { address },
  });
  if (!identity) return null;

  const rows = await prismaQuery.$queryRawUnsafe<MemoryRow[]>(
    `SELECT id, content, category, tags
       FROM "Memory"
      WHERE "identityId" = $1
        AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT ${PORTRAIT_MEMORY_LIMIT}`,
    identity.id
  );

  if (!rows || rows.length === 0) return null;

  const totalCount = await prismaQuery.memory.count({
    where: { identityId: identity.id, deletedAt: null },
  });

  const svg = renderPortraitSvg({
    address,
    totalMemories: totalCount,
    nodes: rows.map((r) => ({
      id: r.id,
      content: r.content,
      category: r.category,
      tags: r.tags ?? [],
    })),
  });

  return svg;
};

// Timelapse variant: buckets the identity's memories by createdAt into `frames`
// time-slices spanning [first memory, now], then renders a single animated SVG
// whose nodes fade in bucket-by-bucket. Degrades to a static single-frame
// render when there is too little history to animate (0/1 memory, zero span),
// and never throws for those cases.
const generateTimelapseFresh = async (
  address: string,
  frames: number
): Promise<string | null> => {
  const identity = await prismaQuery.identity.findFirst({
    where: { address },
  });
  if (!identity) return null;

  const rows = await prismaQuery.$queryRawUnsafe<TimelapseRow[]>(
    `SELECT id, content, category, tags, "createdAt"
       FROM "Memory"
      WHERE "identityId" = $1
        AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${PORTRAIT_TIMELAPSE_LIMIT}`,
    identity.id
  );

  if (!rows || rows.length === 0) return null;

  const totalCount = await prismaQuery.memory.count({
    where: { identityId: identity.id, deletedAt: null },
  });

  // Earliest memory across the WHOLE history (not just the fetched window) so
  // buckets span the true lifetime. ORM select avoids the Unsupported embedding
  // column.
  const firstRow = await prismaQuery.memory.findFirst({
    where: { identityId: identity.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });

  const firstMs = firstRow ? firstRow.createdAt.getTime() : 0;
  const nowMs = Date.now();
  const span = nowMs - firstMs;

  // Not enough temporal spread to animate — render a static frame instead.
  const useTimelapse = rows.length >= 2 && span > 0;

  const nodes = rows.map((r) => ({
    id: r.id,
    content: r.content,
    category: r.category,
    tags: r.tags ?? [],
    bucket: useTimelapse
      ? Math.min(
          frames - 1,
          Math.max(0, Math.floor(((r.createdAt.getTime() - firstMs) / span) * frames))
        )
      : 0,
  }));

  return renderPortraitSvg({
    address,
    totalMemories: totalCount,
    nodes,
    frames: useTimelapse ? frames : undefined,
  });
};

export const getOrGeneratePortrait = async (
  address: string,
  frames?: number
): Promise<string | null> => {
  const normalized = address.toLowerCase();
  const key = frames
    ? timelapseCacheKey(normalized, frames)
    : cacheKey(normalized);

  // Try cache first. On any Redis failure, fall through to fresh generation.
  try {
    const cached = await redis.get(key);
    if (cached) return cached;
  } catch (err) {
    console.warn(
      '[portrait] redis get failed, generating fresh:',
      (err as Error).message
    );
  }

  const svg = frames
    ? await generateTimelapseFresh(normalized, frames)
    : await generateFresh(normalized);
  if (!svg) return null;

  // Best-effort cache write. Never let a Redis outage break the response.
  try {
    await redis.set(key, svg, 'EX', PORTRAIT_CACHE_TTL_SECONDS);
  } catch (err) {
    console.warn(
      '[portrait] redis set failed, returning uncached:',
      (err as Error).message
    );
  }

  return svg;
};

export const bustPortraitCache = async (address: string): Promise<void> => {
  const normalized = address.toLowerCase();
  // Bust the classic key plus every timelapse frame-count variant so a new
  // memory write invalidates all cached renders for this identity.
  const keys = [cacheKey(normalized)];
  for (let f = TIMELAPSE_MIN_FRAMES; f <= TIMELAPSE_MAX_FRAMES; f += 1) {
    keys.push(timelapseCacheKey(normalized, f));
  }
  try {
    await redis.del(...keys);
  } catch {
    // Silently swallow — a stale portrait for up to 300s is acceptable.
  }
};
