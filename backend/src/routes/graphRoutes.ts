import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import { AmberErrorCodes, handleBadInput, handleError } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// Memory Graph — public JSON graph of nodes (memories) and edges (shared tags)
// for visualisation clients (force-directed layouts, spectral projections).
//
// Free, cached in Redis 180s. Node cap = 64, edge cap = 2000 to keep response
// bounded regardless of memory count. Never selects the pgvector `embedding`
// column.
// -----------------------------------------------------------------------------

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 180;
const NODE_LIMIT = 64;
const EDGE_LIMIT = 2000;
const CONTENT_TRUNCATE = 80;

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  tags: string[];
  createdAt: Date | string;
}

interface GraphNode {
  id: string;
  content: string;
  category: string;
  tags: string[];
  createdAt: string;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

interface GraphPayload {
  address: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    totalNodes: number;
    totalEdges: number;
  };
}

const truncate = (s: string): string => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > CONTENT_TRUNCATE ? `${flat.slice(0, CONTENT_TRUNCATE - 1)}…` : flat;
};

const toIso = (d: Date | string): string => {
  if (d instanceof Date) return d.toISOString();
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? String(d) : parsed.toISOString();
};

export const buildGraph = async (address: string): Promise<GraphPayload> => {
  const lower = address.toLowerCase();

  const identity = await prismaQuery.identity.findFirst({
    where: { address: lower },
    select: { id: true },
  });

  if (!identity) {
    return {
      address: lower,
      nodes: [],
      edges: [],
      metadata: { totalNodes: 0, totalEdges: 0 },
    };
  }

  const rows = await prismaQuery.$queryRawUnsafe<MemoryRow[]>(
    `SELECT id, content, category::text AS category, tags, "createdAt"
       FROM "Memory"
      WHERE "identityId" = $1 AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT ${NODE_LIMIT}`,
    identity.id
  );

  const nodes: GraphNode[] = rows.map((r) => ({
    id: r.id,
    content: truncate(r.content),
    category: r.category,
    tags: Array.isArray(r.tags) ? r.tags : [],
    createdAt: toIso(r.createdAt),
  }));

  // Precompute tag sets for cheap intersection counting.
  const tagSets: Array<{ id: string; tags: Set<string> }> = nodes.map((n) => ({
    id: n.id,
    tags: new Set(n.tags),
  }));

  const edges: GraphEdge[] = [];
  outer: for (let i = 0; i < tagSets.length; i += 1) {
    const a = tagSets[i];
    if (!a) continue;
    for (let j = i + 1; j < tagSets.length; j += 1) {
      const b = tagSets[j];
      if (!b) continue;
      let shared = 0;
      for (const t of a.tags) {
        if (b.tags.has(t)) shared += 1;
      }
      if (shared >= 1) {
        // Deterministic direction: lower id → higher id.
        const [source, target] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        edges.push({ source, target, weight: shared });
        if (edges.length >= EDGE_LIMIT) break outer;
      }
    }
  }

  return {
    address: lower,
    nodes,
    edges,
    metadata: { totalNodes: nodes.length, totalEdges: edges.length },
  };
};

const handleGetGraph = async (
  request: FastifyRequest<{ Params: { address: string } }>,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { address } = request.params;
  if (!ADDRESS_REGEX.test(address)) {
    return handleBadInput(reply, 'address must be a valid 0x + 40 hex ERC-8004 identity');
  }
  const lower = address.toLowerCase();

  const cacheKey = `graph:${lower}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header('X-Amber-Graph-Cache', 'HIT');
      return reply.code(200).send({ success: true, error: null, data: JSON.parse(cached) });
    }
  } catch (err) {
    console.warn('[graph] redis get failed, computing fresh:', (err as Error).message);
  }

  try {
    const data = await buildGraph(lower);
    redis
      .set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL_SECONDS)
      .catch((err: Error) => {
        console.warn('[graph] redis cache set failed:', err.message);
      });
    reply.header('X-Amber-Graph-Cache', 'MISS');
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    return handleError(
      reply,
      500,
      'graph generation failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

export const graphRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get('/:address', handleGetGraph);
  done();
};
