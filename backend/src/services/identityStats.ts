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
