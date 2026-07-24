// -----------------------------------------------------------------------------
// Shared test helpers.
//
// The AMBER libs eager-connect Redis on import (src/lib/redis.ts builds the
// client with `lazyConnect: false`). Any test that imports a route/service
// transitively opens that socket, so every spec that does so must call
// closeRedis() in afterAll or `bun test` hangs on the open handle at exit.
//
// dbReachable() lets DB-dependent assertions skip with a clear message instead
// of faking a pass when Postgres is not available (hackathon / CI without DB).
// -----------------------------------------------------------------------------

import { fileURLToPath } from 'node:url';

export const repoPath = (rel: string): string =>
  fileURLToPath(new URL(`../${rel}`, import.meta.url));

export const closeRedis = async (): Promise<void> => {
  try {
    const { redis } = await import('../src/lib/redis.ts');
    redis.disconnect();
  } catch {
    // Nothing imported redis yet — nothing to close.
  }
};

// Best-effort Postgres reachability probe with a hard timeout so an unreachable
// DATABASE_URL cannot hang the suite. Never throws.
export const dbReachable = async (timeoutMs = 3000): Promise<boolean> => {
  try {
    const { prismaQuery } = await import('../src/lib/prisma.ts');
    const probe = prismaQuery.$queryRawUnsafe('SELECT 1');
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('db probe timeout')), timeoutMs)
    );
    await Promise.race([probe, timeout]);
    return true;
  } catch {
    return false;
  }
};
