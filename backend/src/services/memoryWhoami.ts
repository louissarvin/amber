import { prismaQuery } from '../lib/prisma.ts';
import { getOrCreateIdentity } from './identity.ts';
import { PUBLIC_BASE_URL } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// Who Am I + Session Diff — judge/demo hooks from maximize research (§15).
// Deterministic, no LLM. Free / rate-limited at the route layer.
// whoami NEVER writes (idempotent for demos).
// -----------------------------------------------------------------------------

export interface WhoAmIResult {
  identity: string;
  summary: string;
  preferences: Array<{ memoryId: string; content: string; createdAt: string }>;
  facts: Array<{ memoryId: string; content: string; createdAt: string }>;
  pinned: Array<{ memoryId: string; content: string; createdAt: string }>;
  dossier: { memoryId: string | null; content: string; sourceCount: number } | null;
  stats: { totalActive: number; preferenceCount: number; factCount: number; pinnedCount: number };
  portraitUrl: string;
  nextPrompts: string[];
}

export interface SessionDiffResult {
  identity: string;
  since: string;
  added: Array<{
    memoryId: string;
    content: string;
    category: string;
    tags: string[];
    createdAt: string;
  }>;
  count: number;
  note: string;
}

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

export const whoAmI = async (identityAddress: string): Promise<WhoAmIResult> => {
  const identity = await getOrCreateIdentity(identityAddress);
  const addr = identity.address;

  const [prefs, facts, pinned, totalActive, preferenceCount, factCount, pinnedCount, existingDossier] =
    await Promise.all([
      prismaQuery.memory.findMany({
        where: { identityId: identity.id, deletedAt: null, category: 'preference' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, content: true, createdAt: true },
      }),
      prismaQuery.memory.findMany({
        where: { identityId: identity.id, deletedAt: null, category: 'fact' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, content: true, createdAt: true },
      }),
      prismaQuery.memory.findMany({
        where: {
          identityId: identity.id,
          deletedAt: null,
          tags: { has: 'pinned' },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, content: true, createdAt: true },
      }),
      prismaQuery.memory.count({ where: { identityId: identity.id, deletedAt: null } }),
      prismaQuery.memory.count({
        where: { identityId: identity.id, deletedAt: null, category: 'preference' },
      }),
      prismaQuery.memory.count({
        where: { identityId: identity.id, deletedAt: null, category: 'fact' },
      }),
      prismaQuery.memory.count({
        where: { identityId: identity.id, deletedAt: null, tags: { has: 'pinned' } },
      }),
      prismaQuery.memory.findFirst({
        where: {
