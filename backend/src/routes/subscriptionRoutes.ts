import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  closeSubscription,
  getSubscriptionPublic,
  openSubscription,
} from '../services/subscription.ts';
import { AmberErrorCodes, handleBadInput, handleError } from '../utils/errorHandler.ts';
import { IdentityAddressSchema } from '../schemas/memory.ts';

// -----------------------------------------------------------------------------
// x402 `period` scheme — subscription HTTP surface.
// -----------------------------------------------------------------------------

const OpenBodySchema = z.object({
  identity: IdentityAddressSchema,
  budgetAtomic: z
    .union([
      z.string().regex(/^[0-9]+$/, { message: 'budgetAtomic must be a positive integer string' }),
      z.number().int().positive(),
    ])
    .transform((v) => BigInt(v)),
  periodSeconds: z.coerce.number().int().min(60).max(60 * 60 * 24 * 30),
  permit2Nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/, {
    message: 'permit2Nonce must be 0x + 64 hex chars',
  }),
  permit2Signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, {
    message: 'permit2Signature must be 0x + 130 hex chars',
  }),
});

const CloseBodySchema = z.object({
  identity: IdentityAddressSchema,
  issuedAtUnix: z.coerce.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, {
    message: 'signature must be 0x + 130 hex chars',
  }),
});

const SubscriptionIdParamSchema = z.string().min(1).max(64);

const zodFlat = (err: z.ZodError): string =>
  err.errors.map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`).join('; ');

const handleOpen = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = OpenBodySchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const body = parsed.data;

  try {
    const result = await openSubscription({
      identity: body.identity,
      budgetAtomic: body.budgetAtomic,
      periodSeconds: body.periodSeconds,
      permit2Nonce: body.permit2Nonce,
      permit2Signature: body.permit2Signature,
    });

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        subscriptionId: result.subscriptionId,
        expiresAt: result.expiresAt,
        appAccessToken: result.appAccessToken,
        budgetAtomic: result.budgetAtomic,
        spentAtomic: result.spentAtomic,
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'SUBSCRIPTION_BAD_INPUT') {
      return handleError(reply, 400, (err as Error).message, AmberErrorCodes.BAD_INPUT);
    }
    if (code === 'SUBSCRIPTION_INVALID_SIGNATURE') {
      return handleError(reply, 402, 'subscription signature invalid', AmberErrorCodes.PAYMENT_INVALID);
    }
    if ((err as { code?: string }).code === 'P2002') {
      // Permit2 nonce reuse
      return handleError(reply, 409, 'permit2Nonce already used', AmberErrorCodes.PAYMENT_INVALID);
    }
    return handleError(reply, 500, 'subscription open failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleClose = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { id } = request.params as { id?: string };
  const parsedId = SubscriptionIdParamSchema.safeParse(id);
  if (!parsedId.success) return handleBadInput(reply, 'invalid subscription id');

  const parsed = CloseBodySchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const body = parsed.data;

  try {
    const result = await closeSubscription({
      subscriptionId: parsedId.data,
      identity: body.identity,
      issuedAtUnix: body.issuedAtUnix,
      signature: body.signature,
    });
    return reply.code(200).send({
      success: true,
      error: null,
      data: result,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'SUBSCRIPTION_NOT_FOUND') {
      return handleError(reply, 404, 'subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }
    if (code === 'SUBSCRIPTION_FORBIDDEN') {
      return handleError(reply, 403, 'subscription owner mismatch', AmberErrorCodes.MEMORY_FORBIDDEN);
    }
    if (code === 'SUBSCRIPTION_INVALID_SIGNATURE') {
      return handleError(reply, 402, 'close signature invalid', AmberErrorCodes.PAYMENT_INVALID);
    }
    return handleError(reply, 500, 'subscription close failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleGet = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { id } = request.params as { id?: string };
  const parsedId = SubscriptionIdParamSchema.safeParse(id);
  if (!parsedId.success) return handleBadInput(reply, 'invalid subscription id');

  try {
    const view = await getSubscriptionPublic(parsedId.data);
    if (!view) return handleError(reply, 404, 'subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    return reply.code(200).send({ success: true, error: null, data: view });
  } catch (err) {
    return handleError(reply, 500, 'subscription lookup failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

export const subscriptionRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done
) => {
  app.post('/open', handleOpen);
  app.post('/close/:id', handleClose);
  app.get('/:id', handleGet);
  done();
};
