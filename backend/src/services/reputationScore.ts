import { prismaQuery } from '../lib/prisma.ts';
import { PUBLIC_BASE_URL } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// AMBER Reputation Score — the reputation memory layer for the OKX AI marketplace.
//
// OKX AI's core value prop is on-chain reputation that accumulates across work.
// Every ERC-8004 identity that touches AMBER accumulates a public reputation
// footprint here: memories persisted, attestations verified, payments settled,
// verticals covered, pinned facts, longevity.
//
// This is intentionally deterministic. No LLM, no oracle. Every signal is
// verifiable by anyone reading /public/stats and /report/payers.
// -----------------------------------------------------------------------------

export interface ReputationBreakdown {
  persistence: { memories: number; points: number; note: string };
  verification: { attestedRatio: string; points: number; note: string };
  economic: { paidWrites: string; sealCount: number; points: number; note: string };
  breadth: { verticalsUsed: string[]; points: number; note: string };
  deliberateness: { pinnedCount: number; points: number; note: string };
  longevity: { daysActive: number; points: number; note: string };
}

export interface ReputationScoreResult {
  address: string;
  erc8004AgentId: string | null;
  score: number;
  tier: 'unseen' | 'fresh' | 'active' | 'established' | 'trusted';
  tierIcon: string;
  breakdown: ReputationBreakdown;
  totalMemories: number;
  firstSeenAt: string | null;
  lastActiveAt: string | null;
  attestationRate: string;
  summary: string;
  links: {
    portrait: string;
    analytics: string;
    stats: string;
    manifest: string;
  };
  generatedAt: string;
}

const OKX_AI_VERTICAL_TAGS = new Set([
  'asset-creation',
  'resume',
  'creative',
  'software',
  'prediction-market',
]);

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const tierFor = (score: number): { tier: ReputationScoreResult['tier']; icon: string } => {
  if (score >= 75) return { tier: 'trusted', icon: '★' };
  if (score >= 50) return { tier: 'established', icon: '✧' };
  if (score >= 25) return { tier: 'active', icon: '◆' };
  if (score >= 10) return { tier: 'fresh', icon: '○' };
  return { tier: 'unseen', icon: '·' };
};

export class ReputationNotFoundError extends Error {
  code = 'REPUTATION_NOT_FOUND';
}

export const computeReputationScore = async (
  address: string
): Promise<ReputationScoreResult> => {
  const addressLower = address.toLowerCase();

  const identity = await prismaQuery.identity.findUnique({
    where: { address: addressLower },
    select: {
      id: true,
      address: true,
      agentId: true,
      createdAt: true,
      quota: {
        select: { freeUsed: true, paidWrites: true },
      },
    },
  });

  if (!identity) {
    throw new ReputationNotFoundError('identity not found on AMBER');
  }

  // Signal collection — one query per axis so each score component is auditable.
  const [
    totalMemories,
    attestedCount,
    pinnedCount,
    sealCount,
    firstMemory,
    lastMemory,
    verticalTagRows,
  ] = await Promise.all([
    prismaQuery.memory.count({ where: { identityId: identity.id, deletedAt: null } }),
    prismaQuery.memory.count({
      where: {
        identityId: identity.id,
        deletedAt: null,
        attestationId: { not: null },
        attestation: { is: { status: 'attested' } },
      },
    }),
    prismaQuery.memory.count({
      where: { identityId: identity.id, deletedAt: null, tags: { has: 'pinned' } },
    }),
    prismaQuery.seal.count({ where: { identityId: identity.id, deletedAt: null } }),
    prismaQuery.memory.findFirst({
      where: { identityId: identity.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prismaQuery.memory.findFirst({
      where: { identityId: identity.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    // Distinct tags that overlap with the 5 OKX AI verticals.
    prismaQuery.$queryRawUnsafe<Array<{ tag: string }>>(
      `SELECT DISTINCT unnest(tags) AS tag
         FROM "Memory"
        WHERE "identityId" = $1
          AND "deletedAt" IS NULL
          AND tags && ARRAY['asset-creation','resume','creative','software','prediction-market']::text[]`,
      identity.id
    ),
  ]);

  if (totalMemories === 0) {
    throw new ReputationNotFoundError('identity has no memories');
  }

  // ------- Component scoring -------
  // Total possible: 100. Weighted so persistence + verification dominate.

  // 1. Persistence (max 25): 1 memory = 3, 5 = 10, 25 = 20, 100+ = 25.
  const persistencePoints = clamp(Math.round(Math.log10(totalMemories + 1) * 12.5), 0, 25);

  // 2. Verification (max 25): attestation ratio × 25.
  const attestedRatio = totalMemories > 0 ? attestedCount / totalMemories : 0;
  const verificationPoints = Math.round(attestedRatio * 25);

  // 3. Economic (max 20): paid writes + seals both signal willingness to pay.
  const paidWritesNum = Number(identity.quota?.paidWrites ?? 0n);
  const economicPoints = clamp(
    Math.round(Math.log10(paidWritesNum + sealCount + 1) * 15),
    0,
    20
  );

  // 4. Breadth (max 15): how many of the 5 OKX AI verticals this identity uses.
  const verticalsUsed = verticalTagRows
    .map((r) => r.tag)
    .filter((t) => OKX_AI_VERTICAL_TAGS.has(t));
  const breadthPoints = clamp(verticalsUsed.length * 3, 0, 15);

  // 5. Deliberateness (max 10): pinned facts = signal of intent.
  const deliberatenessPoints = clamp(Math.round(Math.log10(pinnedCount + 1) * 8), 0, 10);

  // 6. Longevity (max 5): days between first and last active.
  const daysActive =
    firstMemory && lastMemory
      ? Math.max(
          1,
          Math.floor(
            (lastMemory.createdAt.getTime() - firstMemory.createdAt.getTime()) /
              (1000 * 60 * 60 * 24)
          ) + 1
        )
      : 1;
  const longevityPoints = clamp(Math.round(Math.log10(daysActive + 1) * 4), 0, 5);

  const score = clamp(
    persistencePoints +
      verificationPoints +
      economicPoints +
      breadthPoints +
      deliberatenessPoints +
      longevityPoints,
    0,
    100
  );

  const { tier, icon } = tierFor(score);

  const attestationRateStr =
    totalMemories > 0 ? `${Math.round(attestedRatio * 100)}%` : '0%';

  const summary =
    `${icon} ${tier.toUpperCase()} (${score}/100). ` +
    `${totalMemories} memories, ${attestedCount} attested (${attestationRateStr}), ` +
    `${verticalsUsed.length}/5 OKX AI verticals covered, ` +
    `${pinnedCount} pinned. Active ${daysActive} day${daysActive === 1 ? '' : 's'}.`;

  return {
    address: addressLower,
    erc8004AgentId: identity.agentId,
    score,
    tier,
    tierIcon: icon,
    breakdown: {
      persistence: {
        memories: totalMemories,
        points: persistencePoints,
        note: 'log10(memories+1) × 12.5, capped at 25',
      },
      verification: {
        attestedRatio: attestationRateStr,
        points: verificationPoints,
        note: 'X Layer Merkle attestation ratio × 25',
      },
      economic: {
        paidWrites: paidWritesNum.toString(),
        sealCount,
        points: economicPoints,
        note: 'log10(paidWrites + seals + 1) × 15, capped at 20',
      },
      breadth: {
        verticalsUsed,
        points: breadthPoints,
        note: '3 points per OKX AI vertical touched, capped at 15',
      },
      deliberateness: {
        pinnedCount,
        points: deliberatenessPoints,
        note: 'log10(pinned+1) × 8, capped at 10',
      },
      longevity: {
        daysActive,
        points: longevityPoints,
        note: 'log10(days+1) × 4, capped at 5',
      },
    },
    totalMemories,
    firstSeenAt: firstMemory?.createdAt.toISOString() ?? null,
    lastActiveAt: lastMemory?.createdAt.toISOString() ?? null,
    attestationRate: attestationRateStr,
    summary,
    links: {
      portrait: `${PUBLIC_BASE_URL}/portrait/${addressLower}.svg`,
      analytics: `${PUBLIC_BASE_URL}/analytics/${addressLower}`,
      stats: `${PUBLIC_BASE_URL}/identity/${addressLower}`,
      manifest: `${PUBLIC_BASE_URL}/skills/amber/manifest.json`,
    },
    generatedAt: new Date().toISOString(),
  };
};
