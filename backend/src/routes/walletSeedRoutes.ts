import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { z } from 'zod';
import { incrementRate } from '../services/rateLimit.ts';
import { seedWalletMemories } from '../services/walletSeed.ts';
import { WalletSeedRequestSchema } from '../schemas/seal.ts';
import { AmberErrorCodes, handleBadInput, handleError, handleRateLimited } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// POST /memory/seed-wallet — free, rate-limited X Layer → memory bootstrap.
// Mounted from memoryRoutes (same auth surface as other memory tools).
// -----------------------------------------------------------------------------

const zodFlat = (err: z.ZodError): string =>
  err.errors.map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`).join('; ');

export const handleSeedWallet = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = WalletSeedRequestSchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const body = parsed.data;

  const rate = await incrementRate(body.identity, '/memory/seed-wallet');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const result = await seedWalletMemories({
      identityAddress: body.identity,
      lookbackBlocks: body.lookbackBlocks,
    });
    return reply.code(200).send({
      success: true,
      error: null,
      data: result,
    });
  } catch (err) {
    return handleError(
      reply,
      500,
      'wallet seed failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

// No-op plugin so callers can import the handler only; registration lives in
// memoryRoutes to keep the /memory prefix unified.
export const walletSeedRoutes: FastifyPluginCallback = (
  _app: FastifyInstance,
  _opts,
  done
) => {
  done();
};
