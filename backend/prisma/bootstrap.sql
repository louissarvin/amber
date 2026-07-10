-- =============================================================================
-- AMBER — pgvector bootstrap (manual SQL, run before/after `bun run db:push`)
-- =============================================================================
--
-- Order of operations:
--   1. Run §0001 UP block against your Postgres BEFORE `bun run db:push`.
--      (Prisma will fail to introspect the `vector` type otherwise.)
--   2. Run `bun run db:push` to create tables.
--   3. Run §0002 UP and §0003 UP (CONCURRENTLY indexes cannot live in the
--      same transaction as CREATE TABLE, so we do them last).
--
-- All DOWN blocks are documented next to their UP.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0001 — Enable pgvector extension (run BEFORE db:push)
-- -----------------------------------------------------------------------------

-- UP
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- DOWN
-- DROP EXTENSION IF EXISTS vector;
-- pgcrypto retained by other tables; do NOT drop.

-- -----------------------------------------------------------------------------
-- 0002 — ivfflat index on Memory.embedding (run AFTER db:push)
--
--   lists = 100 is fine up to ~100K rows. For >100K, rebuild with
--   lists = sqrt(row_count).
-- -----------------------------------------------------------------------------

-- UP
CREATE INDEX CONCURRENTLY IF NOT EXISTS "memory_embedding_ivfflat_idx"
  ON "Memory"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- DOWN
-- DROP INDEX CONCURRENTLY IF EXISTS "memory_embedding_ivfflat_idx";

-- -----------------------------------------------------------------------------
-- 0003 — Partial index for active (non-soft-deleted) memories
-- -----------------------------------------------------------------------------

-- UP
CREATE INDEX CONCURRENTLY IF NOT EXISTS "memory_active_identity_created_idx"
  ON "Memory" ("identityId", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

-- DOWN
-- DROP INDEX CONCURRENTLY IF EXISTS "memory_active_identity_created_idx";

-- -----------------------------------------------------------------------------
-- 0004 — PaymentNonce expiry index (helper for cleanup workers)
-- -----------------------------------------------------------------------------

-- UP
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payment_nonce_expires_idx"
  ON "PaymentNonce" ("expiresAt");

-- DOWN
-- DROP INDEX CONCURRENTLY IF EXISTS "payment_nonce_expires_idx";
