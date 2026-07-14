import { prismaQuery } from '../lib/prisma.ts';
import { embed } from '../lib/openai/embeddings.ts';
import { getOrCreateIdentity } from './identity.ts';
import { UNTRUSTED_MEMORY_FRAME } from '../lib/memorySanitize.ts';

// -----------------------------------------------------------------------------
// Memory query service — pgvector cosine top-K.
//
// Uses $queryRawUnsafe so the `::vector` cast literal can be inlined. The
// only inlined value is the numeric embedding array — every user-supplied
// value is parameterised via $2..$5.
// -----------------------------------------------------------------------------

export interface QueryInput {
  identityAddress: string;
  q: string;
  k: number;
  category: string | null;
  since: string | null;
  minRelevance: number;
}

export interface AttestationInline {
  chainId: number;
  txHash: string | null;
  merkleRoot: string | null;
  status: 'pending' | 'submitted' | 'attested' | 'failed';
  attestedAt: string | null;
}

export interface QueryHit {
  memoryId: string;
  content: string;
  category: string;
  tags: string[];
  createdAt: string;
  relevance: number;
  attestation: AttestationInline;
}

export const MEMORY_QUERY_SAFETY_FRAME = UNTRUSTED_MEMORY_FRAME;

interface RawRow {
  memory_id: string;
  content: string;
  category: string;
  tags: string[] | null;
  createdAt: Date;
  relevance: number;
  tx_hash: string | null;
  attestation_status: 'pending' | 'submitted' | 'attested' | 'failed' | null;
  merkle_root: Buffer | null;
  attested_at: Date | null;
}

export const queryTopK = async (input: QueryInput): Promise<QueryHit[]> => {
  const identity = await getOrCreateIdentity(input.identityAddress);
  const embedding = await embed(input.q);
  const lexicalTerms = Array.from(
    new Set(
      input.q
        .toLowerCase()
        .split(/[^a-z0-9_]+/i)
        .map((s) => s.trim())
        .filter((s) => s.length >= 3)
        .slice(0, 8)
    )
  );
  const termsParam = lexicalTerms.length > 0 ? lexicalTerms : ['__amber_no_lexical_match__'];

  // Defensive: every value must be a finite number before SQL interpolation.
  // A malformed or compromised embedding response must not reach the query string.
  if (!embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('embedding contains non-finite values; aborting vector query');
  }

  const vecLiteral = `[${embedding.join(',')}]`;

  // Fetch 3× k so lexical fallback can rescue exact names/terms that vector
  // recall sometimes misses (e.g. "Baxter", "allergy", project codenames).
  const fetchLimit = Math.max(input.k * 3, input.k);

  const sql = `
    WITH q_terms AS (
      SELECT unnest($4::text[]) AS term
    )
    SELECT
      m.id AS memory_id,
      m.content AS content,
      m.category::text AS category,
      m.tags AS tags,
      m."createdAt" AS "createdAt",
      GREATEST(
        1 - (m.embedding <=> '${vecLiteral}'::vector),
        COALESCE(
          (
            SELECT LEAST(1.0, COUNT(*)::float / GREATEST(array_length($4::text[], 1), 1))
              FROM q_terms
             WHERE lower(m.content) LIKE ('%' || q_terms.term || '%')
          ),
          0
        )
      ) AS relevance,
      a."txHash" AS tx_hash,
      a.status::text AS attestation_status,
      a."merkleRoot" AS merkle_root,
      a."attestedAt" AS attested_at
    FROM "Memory" m
    LEFT JOIN "Attestation" a ON a.id = m."attestationId"
    WHERE m."identityId" = $1
      AND m."deletedAt" IS NULL
      AND ($2::text IS NULL OR m.category::text = $2)
      AND ($3::timestamptz IS NULL OR m."createdAt" >= $3)
    ORDER BY relevance DESC, m.embedding <=> '${vecLiteral}'::vector
    LIMIT ${Math.floor(fetchLimit)}
  `;

  const rows = (await prismaQuery.$queryRawUnsafe(
    sql,
    identity.id,
    input.category,
    input.since,
    termsParam
  )) as RawRow[];

  const hits: QueryHit[] = rows
    .filter((r) => Number(r.relevance) >= input.minRelevance)
    .slice(0, input.k)
    .map((r) => ({
      memoryId: r.memory_id,
      content: r.content,
      category: r.category,
      tags: r.tags ?? [],
      createdAt: r.createdAt.toISOString(),
      relevance: Number(r.relevance),
      attestation: {
        chainId: 196,
        txHash: r.tx_hash,
        merkleRoot: r.merkle_root ? `0x${r.merkle_root.toString('hex')}` : null,
        status: r.attestation_status ?? 'pending',
        attestedAt: r.attested_at ? r.attested_at.toISOString() : null,
      },
    }));

  return hits;
};

// -----------------------------------------------------------------------------
// Related memories — pgvector cosine KNN from a seed memory.
// Paid at PRICE_QUERY_ATOMIC per call. Used by /memory/related/:id + MCP tool.
// -----------------------------------------------------------------------------

export interface RelatedInput {
  identityAddress: string;
  memoryId: string;
  k: number;
  minRelevance: number;
}

export const queryRelated = async (input: RelatedInput): Promise<QueryHit[]> => {
  const identity = await getOrCreateIdentity(input.identityAddress);

  // Fetch source embedding — pgvector returns as string like "[0.1,0.2,...]".
  // We must select via $queryRawUnsafe because the embedding column cannot be
  // selected through the Prisma ORM (schema exposes it as Unsupported("vector")).
  const seedRows = (await prismaQuery.$queryRawUnsafe(
    `SELECT id, embedding::text AS embedding_text
       FROM "Memory"
      WHERE id = $1 AND "identityId" = $2 AND "deletedAt" IS NULL
      LIMIT 1`,
    input.memoryId,
    identity.id
  )) as Array<{ id: string; embedding_text: string }>;

  if (seedRows.length === 0) {
    throw Object.assign(new Error('seed memory not found'), { code: 'MEMORY_NOT_FOUND' });
  }
  const seedEmbeddingLiteral = seedRows[0]!.embedding_text;

  const fetchLimit = Math.max(input.k * 2, input.k) + 1; // +1 to skip the seed itself

  const sql = `
    SELECT
      m.id AS memory_id,
      m.content AS content,
      m.category::text AS category,
      m.tags AS tags,
      m."createdAt" AS "createdAt",
      (1 - (m.embedding <=> '${seedEmbeddingLiteral}'::vector)) AS relevance,
      a."txHash" AS tx_hash,
      a.status::text AS attestation_status,
      a."merkleRoot" AS merkle_root,
      a."attestedAt" AS attested_at
    FROM "Memory" m
    LEFT JOIN "Attestation" a ON a.id = m."attestationId"
    WHERE m."identityId" = $1
      AND m."deletedAt" IS NULL
      AND m.id != $2
    ORDER BY m.embedding <=> '${seedEmbeddingLiteral}'::vector
    LIMIT ${Math.floor(fetchLimit)}
  `;

  const rows = (await prismaQuery.$queryRawUnsafe(
    sql,
    identity.id,
    input.memoryId
  )) as RawRow[];

  return rows
    .filter((r) => Number(r.relevance) >= input.minRelevance)
    .slice(0, input.k)
    .map((r) => ({
      memoryId: r.memory_id,
      content: r.content,
      category: r.category,
      tags: r.tags ?? [],
      createdAt: r.createdAt.toISOString(),
      relevance: Number(r.relevance),
      attestation: {
        chainId: 196,
        txHash: r.tx_hash,
        merkleRoot: r.merkle_root ? `0x${r.merkle_root.toString('hex')}` : null,
        status: r.attestation_status ?? 'pending',
        attestedAt: r.attested_at ? r.attested_at.toISOString() : null,
      },
    }));
};
