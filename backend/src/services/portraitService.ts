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
