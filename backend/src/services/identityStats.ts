import { prismaQuery } from '../lib/prisma.ts';
import { PUBLIC_BASE_URL } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// Public identity stats — exposed via GET /identity/:address.
//
// This is a marketing surface: it tells the outside world "yes, this address
// exists on AMBER, and here is how active it has been." Deliberately excludes
// email, wallet balance, subscription details, and any other spendable info.
// -----------------------------------------------------------------------------

export interface IdentityStats {
  address: string;
  erc8004AgentId: string | null;
  memoryCount: number;
  attestedCount: number;
  attestationRate: string;
  sealCount: number;
  freeWrites: number;
  paidWrites: string;
  firstSeenAt: string | null;
  lastActiveAt: string | null;
  links: {
    portrait: string;
    analytics: string;
    graph: string;
  };
}

// Throws `IDENTITY_NOT_REGISTERED` when the identity has not yet made a write.
export const getIdentityStats = async (address: string): Promise<IdentityStats> => {
  const addressLower = address.toLowerCase();

  const identity = await prismaQuery.identity.findUnique({
    where: { address: addressLower },
    select: {
      id: true,
      address: true,
      agentId: true,
      createdAt: true,
      quota: {
        select: {
          freeUsed: true,
          paidWrites: true,
        },
      },
    },
  });

  if (!identity) {
    const err = new Error('identity not registered') as Error & { code: string };
    err.code = 'IDENTITY_NOT_REGISTERED';
    throw err;
  }

  const [memoryCount, attestedCount, sealCount, firstMemory, lastMemory] = await Promise.all([
    prismaQuery.memory.count({
      where: { identityId: identity.id, deletedAt: null },
    }),
    prismaQuery.memory.count({
      where: {
        identityId: identity.id,
        deletedAt: null,
        attestationId: { not: null },
        attestation: { is: { status: 'attested' } },
      },
    }),
    prismaQuery.seal.count({
      where: { identityId: identity.id, deletedAt: null },
    }),
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
  ]);

  // "Not registered on AMBER" is defined as: no writes ever landed. The
  // Identity row can exist as a side effect of a bad request; hide those.
  if (memoryCount === 0) {
    const err = new Error('identity not registered') as Error & { code: string };
    err.code = 'IDENTITY_NOT_REGISTERED';
    throw err;
  }

  const firstSeenAt = firstMemory?.createdAt ?? identity.createdAt;
  const lastActiveAt = lastMemory?.createdAt ?? null;
  const attestationRate =
    memoryCount > 0 ? `${Math.round((attestedCount / memoryCount) * 100)}%` : '0%';
  const addrLower = identity.address;

  return {
    address: addrLower,
    erc8004AgentId: identity.agentId,
    memoryCount,
    attestedCount,
    attestationRate,
    sealCount,
    freeWrites: identity.quota?.freeUsed ?? 0,
    paidWrites: (identity.quota?.paidWrites ?? 0n).toString(),
    firstSeenAt: firstSeenAt ? firstSeenAt.toISOString() : null,
    lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
    links: {
      portrait: `${PUBLIC_BASE_URL}/portrait/${addrLower}.svg`,
      analytics: `${PUBLIC_BASE_URL}/analytics/${addrLower}`,
      graph: `${PUBLIC_BASE_URL}/graph/${addrLower}`,
    },
  };
};
