import { prismaQuery } from '../prisma.ts';
import { redis } from '../redis.ts';
import { FREE_TIER_WRITES_PER_IDENTITY } from '../../config/main-config.ts';

// -----------------------------------------------------------------------------
// Quota service — free-tier gate + paid-usage accounting
//
// Free-tier semantics:
//   - First FREE_TIER_WRITES_PER_IDENTITY writes per identity are free.
//   - `tryConsumeFreeWrite()` performs the free-tier reservation as a single
//     atomic conditional UPDATE. This closes the TOCTOU window that existed
//     between the previous `hasFreeCapacity()` check and the follow-up
//     `bumpFreeUsed()` write, which could double-count under concurrency.
//   - Trade-off: if the caller reserves a slot and then the downstream
//     Memory insert fails, we lose a free-tier count for that identity. We
//     accept this — better than double-counting or race exploitation. The
//     count is monotonically non-decreasing; no identity can exceed the cap.
//
// Redis mirror: `quota:free:{identityAddr}` — INCR alongside the Postgres row
// so the hot path can decide free-vs-paid without a DB read.
// -----------------------------------------------------------------------------

export interface QuotaSnapshot {
  id: string;
  identityId: string;
  freeUsed: number;
  paidWrites: bigint;
  paidQueries: bigint;
  totalPaidAtomic: bigint;
}

const toSnapshot = (row: {
  id: string;
  identityId: string;
  freeUsed: number;
  paidWrites: bigint;
  paidQueries: bigint;
  totalPaidAtomic: bigint;
}): QuotaSnapshot => ({
  id: row.id,
  identityId: row.identityId,
  freeUsed: row.freeUsed,
  paidWrites: row.paidWrites,
  paidQueries: row.paidQueries,
  totalPaidAtomic: row.totalPaidAtomic,
});

export const getOrCreateQuota = async (identityId: string): Promise<QuotaSnapshot> => {
  const existing = await prismaQuery.quota.findUnique({ where: { identityId } });
  if (existing) return toSnapshot(existing);
  const created = await prismaQuery.quota.upsert({
    where: { identityId },
    update: {},
    create: { identityId },
  });
  return toSnapshot(created);
};

export const hasFreeCapacity = (quota: QuotaSnapshot): boolean => {
  return quota.freeUsed < FREE_TIER_WRITES_PER_IDENTITY;
};

export const bumpFreeUsed = async (
  quotaId: string,
  identityAddressLower: string
): Promise<void> => {
  await prismaQuery.quota.update({
    where: { id: quotaId },
    data: { freeUsed: { increment: 1 } },
  });
  redis.incr(`quota:free:${identityAddressLower}`).catch((err: Error) => {
    console.warn('[quota] redis mirror INCR failed:', err.message);
  });
};

// ---------------------------------------------------------------------------
// tryConsumeFreeWrite — atomic conditional UPDATE.
//
// Executes as a single SQL statement:
//
//   UPDATE "Quota"
//   SET "freeUsed" = "freeUsed" + 1, "updatedAt" = NOW()
//   WHERE "identityId" = $1 AND "freeUsed" < $2
//   RETURNING "freeUsed"
//
// -- DOWN migration: none — this is a runtime-only SQL statement, not a
//    schema change. To revert to the old (racy) behaviour, delete this
//    function and switch call-sites back to hasFreeCapacity + bumpFreeUsed.
//
// Returns { consumed: true, freeUsed } if the row was updated.
// Returns { consumed: false, freeUsed } (with the current cap value) if the
// row was NOT eligible — caller must fall through to the paid path.
// ---------------------------------------------------------------------------
export const tryConsumeFreeWrite = async (
  identityAddressLower: string
): Promise<{ consumed: boolean; freeUsed: number }> => {
  // Resolve identityId — this is a fast unique-index lookup.
  const identity = await prismaQuery.identity.findUnique({
    where: { address: identityAddressLower },
    select: { id: true },
  });
  if (!identity) {
    // Identity should have been created before this call, but be defensive.
    return { consumed: false, freeUsed: 0 };
  }

  const rows = (await prismaQuery.$queryRawUnsafe(
    `UPDATE "Quota"
     SET "freeUsed" = "freeUsed" + 1, "updatedAt" = NOW()
     WHERE "identityId" = $1 AND "freeUsed" < $2
     RETURNING "freeUsed"`,
    identity.id,
    FREE_TIER_WRITES_PER_IDENTITY
  )) as Array<{ freeUsed: number }>;

  if (rows.length > 0) {
    redis.incr(`quota:free:${identityAddressLower}`).catch((err: Error) => {
      console.warn('[quota] redis mirror INCR failed:', err.message);
    });
    return { consumed: true, freeUsed: Number(rows[0].freeUsed) };
  }

  // Read current freeUsed for reporting to the caller.
  const q = await prismaQuery.quota.findUnique({
    where: { identityId: identity.id },
    select: { freeUsed: true },
  });
  return { consumed: false, freeUsed: q?.freeUsed ?? FREE_TIER_WRITES_PER_IDENTITY };
};

export const bumpPaidWrite = async (
  quotaId: string,
  amountAtomic: number
): Promise<void> => {
  await prismaQuery.quota.update({
    where: { id: quotaId },
    data: {
      paidWrites: { increment: 1n },
      totalPaidAtomic: { increment: BigInt(amountAtomic) },
    },
  });
};

// Best-effort telemetry — increment paidWrites counter by n. Not
// security-critical: if this fails the write already landed.
export const bumpPaidWrites = async (
  quotaId: string,
  n: number,
  amountAtomicPerItem: number
): Promise<void> => {
  if (n <= 0) return;
  try {
    await prismaQuery.quota.update({
      where: { id: quotaId },
      data: {
        paidWrites: { increment: BigInt(n) },
        totalPaidAtomic: { increment: BigInt(amountAtomicPerItem) * BigInt(n) },
      },
    });
  } catch (err) {
    console.warn('[quota] bumpPaidWrites best-effort failed:', (err as Error).message);
  }
};

export const bumpPaidQuery = async (
  quotaId: string,
  amountAtomic: number
): Promise<void> => {
  await prismaQuery.quota.update({
    where: { id: quotaId },
    data: {
      paidQueries: { increment: 1n },
      totalPaidAtomic: { increment: BigInt(amountAtomic) },
    },
  });
};

export const freeRemaining = (quota: QuotaSnapshot): number => {
  return Math.max(0, FREE_TIER_WRITES_PER_IDENTITY - quota.freeUsed);
};
