import cron from 'node-cron';
import { prismaQuery } from '../lib/prisma.ts';
import { settleTransferWithAuthorization } from '../lib/xlayer/usdt.ts';
import {
  ASP_PRIVATE_KEY,
  ATTESTATION_MAX_RETRIES,
  SETTLE_ON_CHAIN,
  SIGNER_MODE,
  XLAYER_CHAIN_ID,
} from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// paymentSettler — redeems stored EIP-3009 authorizations on-chain.
//
// Reads unsettled PaymentReceipt rows, calls
// USDT.transferWithAuthorization(from, to, value, validAfter, validBefore,
// nonce, v, r, s) via the ASP hot wallet, and records the resulting tx hash.
//
// Runs when SETTLE_ON_CHAIN=true AND ASP_PRIVATE_KEY is set. TEE settle path
// is not implemented (doc 04 §signer). Skips cleanly otherwise so demo
// environments without a funded wallet still boot.
//
// Retry policy:
//   - MAX_ATTEMPTS = ATTESTATION_MAX_RETRIES (reuses the env; same semantics).
//   - Exponential backoff enforced by "was updated recently" filter.
//   - AuthorizationUsed revert -> mark as already-settled (non-fatal).
// -----------------------------------------------------------------------------

let isRunning = false;

const BATCH_SIZE = 20;
const SAFETY_SECONDS = 120; // skip auths expiring within 2 minutes
const WINDOW_MINUTES = 10; // only try recent receipts to avoid hammering stale auths
const BACKOFF_BASE_MS = 5000;

interface AuthJson {
  from: string;
  to: string;
  value: string | number;
  validAfter: string | number;
  validBefore: string | number;
  nonce: string;
}

// USDT contract reverts with "FiatTokenV2: authorization is used or canceled"
// (message varies across forks) once AuthorizationUsed is emitted. If we see
// a revert with that shape, it means someone else already redeemed the auth
// on-chain — mark the receipt as settled without a txHash we can point at.
const isAuthorizationUsedRevert = (err: Error): boolean => {
  const msg = err.message?.toLowerCase() ?? '';
  return (
    msg.includes('authorization is used') ||
    msg.includes('authorization used') ||
    msg.includes('nonce already used')
  );
};

const backoffMs = (attempts: number): number => {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
};

const settleOnce = async (): Promise<void> => {
  if (isRunning) return;
  if (!ASP_PRIVATE_KEY || !SETTLE_ON_CHAIN) return;
  isRunning = true;

  try {
    const nowUnix = Math.floor(Date.now() / 1000);
    const minValidBefore = nowUnix + SAFETY_SECONDS;
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000);

    // Prisma client type may not yet know about settleAttempts / settleError
    // until `bun run db:push` regenerates the client. Cast where needed.
    const receipts = await prismaQuery.paymentReceipt.findMany({
      where: {
        txHash: null,
        settledAt: null,
        createdAt: { gte: windowStart },
        ...({ settleAttempts: { lt: ATTESTATION_MAX_RETRIES } } as unknown as Record<
          string,
          unknown
        >),
      },
      orderBy: { updatedAt: 'asc' },
      take: BATCH_SIZE,
    });

    let settled = 0;
    let alreadySettled = 0;
    let failed = 0;

    for (const receipt of receipts) {
      const auth = receipt.authorization as unknown as AuthJson;
      if (!auth?.from || !auth?.nonce || !auth?.validBefore) {
        // Malformed row — bump attempts so we don't spin.
        await prismaQuery.paymentReceipt.update({
          where: { id: receipt.id },
          data: {
            ...({
              settleAttempts: { increment: 1 },
              settleError: 'authorization JSON malformed',
            } as unknown as Record<string, unknown>),
          },
        });
        failed += 1;
        continue;
      }

      const validBefore = Number(auth.validBefore);
      const validAfter = Number(auth.validAfter);
      if (validBefore < minValidBefore) {
        // Expired or too close to expiry — mark as permanently unsettleable.
        await prismaQuery.paymentReceipt.update({
          where: { id: receipt.id },
          data: {
            ...({
              settleAttempts: ATTESTATION_MAX_RETRIES,
              settleError: 'authorization window closed before settlement',
            } as unknown as Record<string, unknown>),
          },
        });
        continue;
      }
      if (validAfter > nowUnix) {
        // Not yet valid — leave for the next tick.
        continue;
      }

      // Backoff — skip rows whose updatedAt is fresher than the backoff window.
      const attempts = (receipt as unknown as { settleAttempts?: number }).settleAttempts ?? 0;
      if (attempts > 0) {
        const wait = backoffMs(attempts);
        const nextEligible = receipt.updatedAt.getTime() + wait;
        if (Date.now() < nextEligible) continue;
      }

      try {
        const txHash = await settleTransferWithAuthorization({
          from: auth.from,
          to: auth.to,
          value: BigInt(auth.value),
          validAfter: BigInt(auth.validAfter),
          validBefore: BigInt(auth.validBefore),
          nonce: auth.nonce,
          signature: receipt.signature,
        });

        await prismaQuery.paymentReceipt.update({
          where: { id: receipt.id },
          data: {
            txHash,
            settledAt: new Date(),
            ...({
              chainId: XLAYER_CHAIN_ID,
              settleError: null,
            } as unknown as Record<string, unknown>),
          },
        });
        settled += 1;
      } catch (err) {
        const e = err as Error;
        if (isAuthorizationUsedRevert(e)) {
          // AuthorizationUsed — someone else redeemed it. Non-fatal.
          await prismaQuery.paymentReceipt.update({
            where: { id: receipt.id },
            data: {
              settledAt: new Date(),
              ...({
                chainId: XLAYER_CHAIN_ID,
                settleError: 'already-settled',
              } as unknown as Record<string, unknown>),
            },
          });
          alreadySettled += 1;
          continue;
        }
        await prismaQuery.paymentReceipt.update({
          where: { id: receipt.id },
          data: {
            ...({
              settleAttempts: { increment: 1 },
              settleError: e.message.slice(0, 500),
            } as unknown as Record<string, unknown>),
          },
        });
        failed += 1;
        console.warn(
          `[paymentSettler] settle failed for receipt ${receipt.id} (attempt ${attempts + 1}):`,
          e.message
        );
      }
    }

    if (settled + alreadySettled + failed > 0) {
      console.log(
        `[paymentSettler] tick: settled=${settled} alreadySettled=${alreadySettled} failed=${failed} inspected=${receipts.length}`
      );
    }
  } catch (err) {
    console.error('[paymentSettler] loop failed:', (err as Error).message);
  } finally {
    isRunning = false;
  }
};

export const startPaymentSettler = (): void => {
  if (!SETTLE_ON_CHAIN) {
    console.log('[paymentSettler] skipped (SETTLE_ON_CHAIN=false)');
    return;
  }
  if (!ASP_PRIVATE_KEY) {
    console.log(
      `[paymentSettler] skipped (no ASP_PRIVATE_KEY; SIGNER_MODE=${SIGNER_MODE}). Receipts remain off-chain proofs.`
    );
    return;
  }

  cron.schedule('*/30 * * * * *', () => {
    void settleOnce();
  });
  console.log('[paymentSettler] scheduled every 30s (self-custody on-chain redeem)');
};

export const _test_settleOnce = settleOnce;
