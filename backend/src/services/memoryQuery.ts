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

