import cron from 'node-cron';
import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import {
  leafHash,
  merkleRoot,
  type PendingAttestation,
  MAX_BATCH_LEAVES,
} from '../lib/merkle.ts';
import { BroadcastPendingError, sendAttestation, signerAddressForMode } from '../lib/xlayer/attestation.ts';
import { getOrCreateIdentity } from '../services/identity.ts';
import {
  ATTESTATION_BATCH_SIZE,
  ATTESTATION_INTERVAL_SECONDS,
  ATTESTATION_MAX_RETRIES,
  SIGNER_MODE,
  XLAYER_CHAIN_ID,
} from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// Attestation batcher — pops up to N pending entries every 15s, groups by
// identity, computes a keccak256 Merkle root, and calls the on-chain
// attestation contract via the configured signer.
//
// isRunning guard follows the starter convention.
// -----------------------------------------------------------------------------

let isRunning = false;

const backoffMs = (attempt: number): number => {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 30 * 60_000);
};

const processGroup = async (
  address: string,
  group: PendingAttestation[]
): Promise<void> => {
  const identity = await getOrCreateIdentity(address);
  const leaves = group.map(leafHash);
  const root = merkleRoot(leaves);

  const rootBytes = new Uint8Array(root);
  const leafBytes = leaves.map((l) => new Uint8Array(l));

  const attestation = await prismaQuery.attestation.create({
    data: {
      identityId: identity.id,
      merkleRoot: rootBytes,
      status: 'submitted',
      signerMode: SIGNER_MODE,
      chainId: XLAYER_CHAIN_ID,
      submittedAt: new Date(),
      leaves: {
        create: group.map((it, idx) => ({
          memoryId: it.memoryId,
          leafHash: leafBytes[idx],
          position: idx,
        })),
      },
    },
  });

  // Point each memory row at the attestation before we submit — the
  // Attestation row is the source of truth for status even if the tx fails.
  await prismaQuery.memory.updateMany({
    where: { id: { in: group.map((g) => g.memoryId) } },
    data: { attestationId: attestation.id },
  });

  try {
    const timestampUnix = Math.floor(Date.now() / 1000);
    const { txHash, signerAddress } = await sendAttestation(root, address, timestampUnix);
    await prismaQuery.attestation.update({
      where: { id: attestation.id },
      data: {
        status: 'attested',
        txHash,
        signerAddress,
        attestedAt: new Date(),
      },
    });
    console.log('[AttestationBatcher] attested', {
      attestationId: attestation.id,
      identity: address,
      leafCount: group.length,
      root: `0x${root.toString('hex')}`,
      txHash,
    });
  } catch (err) {
    const message = (err as Error).message;
    // If we got a broadcast+wait-timeout, we still know the txHash. Persist
    // it so the retry worker can check the receipt before resubmitting.
    const lastTxHash = err instanceof BroadcastPendingError ? err.txHash : null;
    console.error('[AttestationBatcher] submit failed', {
      attestationId: attestation.id,
      identity: address,
      retries: attestation.retries,
      lastTxHash,
      error: message,
    });
    await prismaQuery.attestation.update({
      where: { id: attestation.id },
      data: {
        status: 'failed',
        retries: { increment: 1 },
        lastError: message,
        // Cast: `lastTxHash` not visible until `db:push` regenerates client.
        ...(lastTxHash ? ({ lastTxHash } as unknown as { lastTxHash: string }) : {}),
      },
    });
    // Do not requeue here — the attestationRetry worker picks up failed rows.
  }
};

const runOnce = async (): Promise<void> => {
  if (isRunning) {
    console.log('[AttestationBatcher] Previous run still active, skipping...');
    return;
  }
  isRunning = true;
  try {
    const cap = Math.min(ATTESTATION_BATCH_SIZE, MAX_BATCH_LEAVES);
    const raw = await redis.lrange('pending:attestations', 0, cap - 1);
    if (raw.length === 0) return;

    // Parse; drop items that fail to parse to avoid infinite failures on a bad row.
    const items: PendingAttestation[] = [];
    for (const s of raw) {
      try {
        items.push(JSON.parse(s) as PendingAttestation);
      } catch (err) {
        console.warn('[AttestationBatcher] dropped malformed pending item:', (err as Error).message);
      }
    }

    const groups = new Map<string, PendingAttestation[]>();
    for (const it of items) {
      const key = it.identityAddress.toLowerCase();
      const arr = groups.get(key) ?? [];
      arr.push(it);
      groups.set(key, arr);
    }

    for (const [address, group] of groups) {
      try {
        await processGroup(address, group);
      } catch (err) {
        console.error('[AttestationBatcher] group failed', address, (err as Error).message);
      }
    }

    // Trim only the raw items we popped, regardless of individual failures. The
    // memories have Attestation rows; retry worker handles failed rows.
    await redis.ltrim('pending:attestations', raw.length, -1);
  } catch (error) {
    console.error('[AttestationBatcher] Error:', error);
  } finally {
    isRunning = false;
  }
};

export const startAttestationBatcher = (): void => {
  const address = signerAddressForMode();
  console.log(
    `[AttestationBatcher] scheduled every ${ATTESTATION_INTERVAL_SECONDS}s; signer=${SIGNER_MODE} address=${address ?? '<unset>'}`
  );
  const pattern = `*/${ATTESTATION_INTERVAL_SECONDS} * * * * *`;
  try {
    cron.schedule(pattern, runOnce);
  } catch (err) {
    // node-cron 3.x supports 6-field patterns; if the runtime version rejects
    // it, fall back to setInterval.
    console.warn(
      '[AttestationBatcher] 6-field cron pattern rejected, using setInterval:',
      (err as Error).message
    );
    setInterval(runOnce, ATTESTATION_INTERVAL_SECONDS * 1000);
  }
};

export const _test_runOnce = runOnce;
export const _test_backoffMs = backoffMs;
export const _test_maxRetries = ATTESTATION_MAX_RETRIES;
