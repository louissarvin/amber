import { prismaQuery } from '../lib/prisma.ts';
import { resolveErc8004 } from '../lib/xlayer/erc8004.ts';
import { REQUIRE_ERC8004_REGISTERED } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// Identity service — get-or-create with best-effort ERC-8004 resolution.
//
// ADR-006: the raw 20-byte address is the authoritative namespace. The
// ERC-8004 agentId is decorative unless REQUIRE_ERC8004_REGISTERED=true.
// -----------------------------------------------------------------------------

export interface IdentityRow {
  id: string;
  address: string;
  agentId: string | null;
  reputation: number | null;
}

const normalize = (addr: string): string => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(`invalid ethereum address: ${addr}`);
  }
  return addr.toLowerCase();
};

export const getOrCreateIdentity = async (address: string): Promise<IdentityRow> => {
  const addr = normalize(address);

  const existing = await prismaQuery.identity.findUnique({ where: { address: addr } });
  if (existing) {
    return {
      id: existing.id,
      address: existing.address,
      agentId: existing.agentId,
      reputation: existing.reputation,
    };
  }

  // First sighting — trigger a best-effort registry read (non-blocking on the
  // hot path when it fails; when REQUIRE_ERC8004_REGISTERED=true we do reject).
  let agentId: string | null = null;
  let reputation: number | null = null;
  try {
    const res = await resolveErc8004(addr);
    agentId = res.agentId;
    reputation = res.reputation;
  } catch (err) {
    console.warn('[identity] erc8004 resolve threw:', (err as Error).message);
  }

  if (REQUIRE_ERC8004_REGISTERED && !agentId) {
    throw new Error(`ERC-8004 registration required but ${addr} is not registered`);
  }

  const created = await prismaQuery.identity.upsert({
    where: { address: addr },
    update: {},
    create: {
      address: addr,
      agentId,
      reputation,
      resolvedAt: agentId ? new Date() : null,
    },
  });
  return {
    id: created.id,
    address: created.address,
    agentId: created.agentId,
    reputation: created.reputation,
  };
};
