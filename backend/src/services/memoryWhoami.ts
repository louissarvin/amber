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
          identityId: identity.id,
          deletedAt: null,
          OR: [{ tags: { has: 'dossier' } }, { tags: { has: 'consolidate' } }],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, content: true, metadata: true },
      }),
    ]);

  let dossier: WhoAmIResult['dossier'] = null;
  if (existingDossier) {
    const meta = existingDossier.metadata as { sourceCount?: number } | null;
    dossier = {
      memoryId: existingDossier.id,
      content: truncate(existingDossier.content, 600),
      sourceCount: meta?.sourceCount ?? 0,
    };
  } else if (prefs.length || facts.length || pinned.length) {
    const lines = [
      ...prefs.map((p, i) => `${i + 1}. [preference] ${truncate(p.content, 120)}`),
      ...facts.map((f, i) => `${prefs.length + i + 1}. [fact] ${truncate(f.content, 120)}`),
      ...pinned.map(
        (p, i) => `${prefs.length + facts.length + i + 1}. [pinned] ${truncate(p.content, 120)}`
      ),
    ];
    dossier = {
      memoryId: null,
      content: truncate(`Live identity snapshot for ${addr}.\n${lines.join('\n')}`, 600),
      sourceCount: lines.length,
    };
  }

  const summaryLines: string[] = [];
  if (prefs.length) {
    summaryLines.push(`Preferences: ${prefs.map((p) => truncate(p.content, 80)).join(' · ')}`);
  }
  if (facts.length) {
    summaryLines.push(`Facts: ${facts.map((f) => truncate(f.content, 80)).join(' · ')}`);
  }
  if (pinned.length) {
    summaryLines.push(`Pinned: ${pinned.map((p) => truncate(p.content, 80)).join(' · ')}`);
  }
  if (!summaryLines.length) {
    summaryLines.push(
      'No memories yet. Run memory_demo_pack or memory_seed_wallet, then ask who am I again.'
    );
  }

  return {
    identity: addr,
    summary: summaryLines.join('\n'),
    preferences: prefs.map((p) => ({
      memoryId: p.id,
      content: p.content,
      createdAt: p.createdAt.toISOString(),
    })),
    facts: facts.map((f) => ({
      memoryId: f.id,
      content: f.content,
      createdAt: f.createdAt.toISOString(),
    })),
    pinned: pinned.map((p) => ({
      memoryId: p.id,
      content: p.content,
      createdAt: p.createdAt.toISOString(),
    })),
    dossier,
    stats: { totalActive, preferenceCount, factCount, pinnedCount },
    portraitUrl: `${PUBLIC_BASE_URL}/portrait/${addr}.svg`,
    nextPrompts: [
      `Remember this preference for identity ${addr}: I prefer concise answers.`,
      `What changed in my AMBER memory since yesterday?`,
      `Run AMBER demo pack for ${addr}`,
    ],
  };
};

export const sessionDiff = async (
  identityAddress: string,
  sinceIso: string
): Promise<SessionDiffResult> => {
  const identity = await getOrCreateIdentity(identityAddress);
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) {
    throw Object.assign(new Error('since must be a valid ISO-8601 timestamp'), {
      code: 'BAD_INPUT',
    });
  }

  const rows = await prismaQuery.memory.findMany({
    where: {
      identityId: identity.id,
      deletedAt: null,
      createdAt: { gt: since },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: {
      id: true,
      content: true,
      category: true,
      tags: true,
      createdAt: true,
    },
  });

  return {
    identity: identity.address,
    since: since.toISOString(),
    added: rows.map((r) => ({
      memoryId: r.id,
      content: r.content,
      category: r.category,
      tags: r.tags,
      createdAt: r.createdAt.toISOString(),
    })),
    count: rows.length,
    note:
      rows.length === 0
        ? 'No new memories since that timestamp.'
        : `${rows.length} memories written since ${since.toISOString()}.`,
  };
};

export const setMemoryPinned = async (
  identityAddress: string,
  memoryId: string,
  pinned: boolean
): Promise<{ memoryId: string; pinned: boolean; tags: string[] }> => {
  const identity = await getOrCreateIdentity(identityAddress);
  const row = await prismaQuery.memory.findFirst({
    where: { id: memoryId, identityId: identity.id, deletedAt: null },
    select: { id: true, tags: true, metadata: true },
  });
  if (!row) {
    throw Object.assign(new Error('memory not found'), { code: 'MEMORY_NOT_FOUND' });
  }

  const tags = new Set(row.tags ?? []);
  if (pinned) tags.add('pinned');
  else tags.delete('pinned');

  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? { ...(row.metadata as Record<string, unknown>), pinned }
      : { pinned };

  const updated = await prismaQuery.memory.update({
    where: { id: memoryId },
    data: {
      tags: Array.from(tags),
      metadata: metadata as object,
    },
    select: { id: true, tags: true },
  });

  return { memoryId: updated.id, pinned, tags: updated.tags };
};
