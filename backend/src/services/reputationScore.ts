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
