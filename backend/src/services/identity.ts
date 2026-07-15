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
