import cron from 'node-cron';
import { prismaQuery } from '../lib/prisma.ts';
import { BroadcastPendingError, sendAttestation } from '../lib/xlayer/attestation.ts';
import { xlayerProvider } from '../lib/xlayer/rpc.ts';
import { ATTESTATION_MAX_RETRIES } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// Attestation retry — every minute, sweep `Attestation` rows with
// status='failed' and retries < max; re-submit. If a row exceeds
// ATTESTATION_MAX_RETRIES it stays failed and requires manual intervention.
//
// Before re-broadcasting we check whether the previously broadcast tx (if
// any) has actually confirmed. Without this check, transient wait timeouts
// would cause the retry worker to submit a duplicate on-chain attestation
// for a tx that had, in fact, been mined successfully.
//
// This is a separate worker from the batcher so failure retries do not
// block the hot-path batch loop, and so exponential backoff is naturally
// spaced by the cron interval.
// -----------------------------------------------------------------------------

let isRunning = false;

const runOnce = async (): Promise<void> => {
  if (isRunning) return;
  isRunning = true;
  try {
    const failed = await prismaQuery.attestation.findMany({
      where: {
        status: 'failed',
        retries: { lt: ATTESTATION_MAX_RETRIES },
      },
      include: { identity: true },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });

    for (const att of failed) {
      const address = att.identity.address;
      // `lastTxHash` was added by SECURITY_AUDIT_FIX H-3 (2026-07-13).
      // Cast until `bun run db:push` regenerates the Prisma client and the
      // column becomes visible on the row type.
      const lastTxHashOnRow = (att as unknown as { lastTxHash: string | null }).lastTxHash;

      // SECURITY FIX H-3: if a tx was previously broadcast, look up the
      // receipt on-chain BEFORE resubmitting. If it succeeded, adopt it and
      // mark this row attested. Only broadcast a fresh tx when we have no
      // prior tx hash to check.
      if (lastTxHashOnRow) {
        try {
          const receipt = await xlayerProvider().getTransactionReceipt(lastTxHashOnRow);
          if (receipt && receipt.status === 1) {
            await prismaQuery.attestation.update({
              where: { id: att.id },
              data: {
                status: 'attested',
                txHash: lastTxHashOnRow,
                attestedAt: new Date(),
                lastError: null,
              },
            });
            // Ensure associated Memory rows point at this Attestation row.
            // Batcher already did this on initial submit; retained for safety.
            await prismaQuery.memory.updateMany({
              where: { attestationId: att.id },
              data: { attestationId: att.id },
            });
            console.log('[AttestationRetry] adopted prior tx', {
              attestationId: att.id,
              identity: address,
              txHash: lastTxHashOnRow,
            });
            continue;
          }
          if (receipt && receipt.status !== 1) {
            // On-chain reverted. Fall through to a fresh broadcast.
            console.warn('[AttestationRetry] prior tx reverted, will re-broadcast', {
              attestationId: att.id,
              txHash: lastTxHashOnRow,
            });
          }
        } catch (err) {
          // Receipt lookup failure is non-fatal — fall through to resubmit.
          console.warn('[AttestationRetry] receipt lookup failed', {
            attestationId: att.id,
            txHash: lastTxHashOnRow,
            error: (err as Error).message,
          });
        }
      }

      const timestampUnix = Math.floor(Date.now() / 1000);
      try {
        const rootBuf = Buffer.from(att.merkleRoot);
        const { txHash, signerAddress } = await sendAttestation(
          rootBuf,
          address,
          timestampUnix
        );
        await prismaQuery.attestation.update({
          where: { id: att.id },
          data: {
            status: 'attested',
            txHash,
            signerAddress,
            attestedAt: new Date(),
            lastError: null,
          },
        });
        console.log('[AttestationRetry] recovered', {
          attestationId: att.id,
          identity: address,
          txHash,
        });
      } catch (err) {
        const message = (err as Error).message;
        const nextLastTxHash = err instanceof BroadcastPendingError ? err.txHash : null;
        await prismaQuery.attestation.update({
          where: { id: att.id },
          data: {
            retries: { increment: 1 },
            lastError: message,
            // Cast: `lastTxHash` column not visible until `db:push` regenerates client.
            ...(nextLastTxHash ? ({ lastTxHash: nextLastTxHash } as unknown as { lastTxHash: string }) : {}),
          },
        });
        console.warn('[AttestationRetry] still failing', {
          attestationId: att.id,
          retries: att.retries + 1,
          lastTxHash: nextLastTxHash,
          error: message,
        });
      }
    }
  } catch (error) {
    console.error('[AttestationRetry] error', error);
  } finally {
    isRunning = false;
  }
};

export const startAttestationRetry = (): void => {
  console.log('[AttestationRetry] scheduled every 1 minute');
  cron.schedule('* * * * *', runOnce);
};
