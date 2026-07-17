import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';

// -----------------------------------------------------------------------------
// Marketplace / Memory Report metrics.
// Powers Daily Memory Report threads + Revenue Rocket evidence for judges.
// -----------------------------------------------------------------------------

export interface AmberStats {
  windowHours: number;
  identities: {
    total: number;
    activeInWindow: number;
  };
  memories: {
    totalActive: number;
    writtenInWindow: number;
    attestedInWindow: number;
    pendingAttestation: number;
  };
  payments: {
    // Authorized = every verified EIP-3009 payment receipt (txHash may be null).
    receiptCountInWindow: number;
    totalPaidAtomicInWindow: string;
    totalPaidUsdtInWindow: string;
    // Settled = redeemed on-chain (txHash / settledAt present). This is the
    // honest headline figure: it is verifiable against X Layer.
    settledOnChainInWindow: number;
    settledPaidAtomicInWindow: string;
    settledPaidUsdtInWindow: string;
    // Pending = authorized but not yet settled on-chain (awaiting paymentSettler).
    pendingCountInWindow: number;
    pendingPaidUsdtInWindow: string;
  };
  quota: {
    freeWritesConsumed: number;
    paidWrites: string;
    paidQueries: string;
  };
  queue: {
    pendingAttestationsDepth: number;
  };
  topCategories: Array<{ category: string; count: number }>;
  generatedAt: string;
}

const atomicToUsdt = (atomic: bigint): string => {
  const whole = atomic / 1_000_000n;
  const frac = (atomic % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${frac}`;
};

export const collectAmberStats = async (windowHours = 24): Promise<AmberStats> => {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const [
    totalIdentities,
    activeIdentities,
    totalActiveMemories,
    writtenInWindow,
    attestedInWindow,
    pendingAttestation,
    receiptAgg,
    settledAgg,
    quotaAgg,
    categoryRows,
  ] = await Promise.all([
    prismaQuery.identity.count(),
    prismaQuery.memory.findMany({
      where: { createdAt: { gte: since }, deletedAt: null },
      distinct: ['identityId'],
      select: { identityId: true },
    }),
    prismaQuery.memory.count({ where: { deletedAt: null } }),
    prismaQuery.memory.count({ where: { createdAt: { gte: since }, deletedAt: null } }),
    prismaQuery.attestation.count({
      where: { status: 'attested', attestedAt: { gte: since } },
    }),
    prismaQuery.memory.count({
      where: { deletedAt: null, attestationId: null },
    }),
    prismaQuery.paymentReceipt.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { amountAtomic: true },
    }),
    // Settled-on-chain only: txHash present == redeemed via transferWithAuthorization
    // on X Layer. settledAt is set in the same paymentSettler write, so either
    // predicate is equivalent; txHash is the on-chain-verifiable one.
    prismaQuery.paymentReceipt.aggregate({
      where: { createdAt: { gte: since }, txHash: { not: null } },
      _count: { _all: true },
      _sum: { amountAtomic: true },
    }),
    prismaQuery.quota.aggregate({
      _sum: {
        freeUsed: true,
        paidWrites: true,
        paidQueries: true,
      },
    }),
    prismaQuery.$queryRawUnsafe(
      `
      SELECT category::text AS category, COUNT(*)::int AS count
        FROM "Memory"
       WHERE "deletedAt" IS NULL
         AND "createdAt" >= $1
       GROUP BY category
       ORDER BY count DESC
       LIMIT 5
      `,
      since
    ) as Promise<Array<{ category: string; count: number }>>,
  ]);

  let pendingDepth = 0;
  try {
    pendingDepth = await redis.llen('pending:attestations');
  } catch {
    pendingDepth = -1;
  }

  const paidAtomic = receiptAgg._sum.amountAtomic ?? 0n;
  const settledAtomic = settledAgg._sum.amountAtomic ?? 0n;
  const settledCount = settledAgg._count._all;
  const pendingAtomic = paidAtomic - settledAtomic;
  const pendingCount = receiptAgg._count._all - settledCount;

  return {
    windowHours,
    identities: {
      total: totalIdentities,
      activeInWindow: activeIdentities.length,
    },
    memories: {
      totalActive: totalActiveMemories,
      writtenInWindow,
      attestedInWindow,
      pendingAttestation,
    },
    payments: {
      receiptCountInWindow: receiptAgg._count._all,
      totalPaidAtomicInWindow: paidAtomic.toString(),
      totalPaidUsdtInWindow: atomicToUsdt(paidAtomic),
      settledOnChainInWindow: settledCount,
      settledPaidAtomicInWindow: settledAtomic.toString(),
      settledPaidUsdtInWindow: atomicToUsdt(settledAtomic),
      pendingCountInWindow: pendingCount,
      pendingPaidUsdtInWindow: atomicToUsdt(pendingAtomic < 0n ? 0n : pendingAtomic),
    },
    quota: {
      freeWritesConsumed: quotaAgg._sum.freeUsed ?? 0,
      paidWrites: (quotaAgg._sum.paidWrites ?? 0n).toString(),
      paidQueries: (quotaAgg._sum.paidQueries ?? 0n).toString(),
    },
    queue: {
      pendingAttestationsDepth: pendingDepth,
    },
    topCategories: categoryRows.map((r) => ({
      category: r.category,
      count: Number(r.count),
    })),
    generatedAt: new Date().toISOString(),
  };
};

export interface MemoryReportCard {
  headline: string;
  bullets: string[];
  stats: AmberStats;
}

export const buildMemoryReportCard = async (windowHours = 24): Promise<MemoryReportCard> => {
  const stats = await collectAmberStats(windowHours);
  const top =
    stats.topCategories.length > 0
      ? stats.topCategories.map((c) => `${c.category}(${c.count})`).join(', ')
      : 'none yet';

  return {
    headline: `AMBER Memory Report — last ${windowHours}h`,
    bullets: [
      `${stats.memories.writtenInWindow} memories written by ${stats.identities.activeInWindow} identities`,
      `${stats.memories.attestedInWindow} batches attested on X Layer`,
      `${stats.payments.settledPaidUsdtInWindow} USDT settled on-chain across ${stats.payments.settledOnChainInWindow} receipts (${stats.payments.pendingPaidUsdtInWindow} USDT authorized, pending settlement)`,
      `Top categories: ${top}`,
      `Queue depth: ${stats.queue.pendingAttestationsDepth}`,
    ],
    stats,
  };
};
