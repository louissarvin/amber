import cron from 'node-cron';
import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';

// -----------------------------------------------------------------------------
// Unattested memory sweeper — recovers memories whose Redis enqueue was lost
// (process crash, Redis restart) so the attestation batcher can still pick them up.
// -----------------------------------------------------------------------------

let isRunning = false;

const SWEEP_LIMIT = 100;
const MIN_AGE_MINUTES = 10;

const sweepOnce = async (): Promise<void> => {
  if (isRunning) return;
  isRunning = true;
  try {
    const cutoff = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000);
    const rows = await prismaQuery.memory.findMany({
      where: {
        deletedAt: null,
        attestationId: null,
        createdAt: { lt: cutoff },
      },
      take: SWEEP_LIMIT,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        contentHash: true,
        category: true,
        createdAt: true,
        identity: { select: { address: true } },
      },
    });

    if (rows.length === 0) return;

    let enqueued = 0;
    for (const row of rows) {
      try {
        await redis.rpush(
          'pending:attestations',
          JSON.stringify({
            memoryId: row.id,
            identityAddress: row.identity.address,
            contentHash: `0x${Buffer.from(row.contentHash).toString('hex')}`,
            category: row.category,
            createdAtUnix: Math.floor(row.createdAt.getTime() / 1000),
          })
        );
        enqueued += 1;
      } catch (err) {
        console.warn(
          '[unattestedSweeper] enqueue failed for',
          row.id,
          (err as Error).message
        );
      }
    }

    if (enqueued > 0) {
      console.log(`[unattestedSweeper] re-enqueued ${enqueued}/${rows.length} memories`);
    }
  } catch (err) {
    console.error('[unattestedSweeper] sweep failed:', (err as Error).message);
  } finally {
    isRunning = false;
  }
};

export const startUnattestedSweeper = (): void => {
  // Every 5 minutes.
  cron.schedule('*/5 * * * *', () => {
    void sweepOnce();
  });
  console.log('[unattestedSweeper] scheduled every 5 minutes');
};
