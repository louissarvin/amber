import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getIdentityStats } from '../services/identityStats.ts';
import { computeReputationScore, ReputationNotFoundError } from '../services/reputationScore.ts';
import { AmberErrorCodes, handleBadInput, handleError } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// Public identity read surface. Free, unauthenticated, no PII exposure.
// -----------------------------------------------------------------------------

const AddressParamSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, { message: 'address must be a 0x-prefixed 40-hex address' });

const handleGetStats = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { address } = request.params as { address?: string };
  const parsed = AddressParamSchema.safeParse(address);
  if (!parsed.success) return handleBadInput(reply, parsed.error.errors[0]?.message ?? 'invalid address');

  try {
    const stats = await getIdentityStats(parsed.data);
    return reply.code(200).send({
      success: true,
      error: null,
      data: stats,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'IDENTITY_NOT_REGISTERED') {
      return handleError(reply, 404, 'identity not registered on AMBER', 'IDENTITY_NOT_REGISTERED');
    }
    return handleError(
      reply,
      500,
      'identity lookup failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

// AMBER Reputation Score — the reputation memory layer for the OKX AI marketplace.
// Aggregates persistence, verification, economic activity, breadth, deliberateness,
// and longevity into a single 0-100 score with a full audit breakdown. Free, cached
// implicitly through underlying stats queries.
const handleReputation = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { address } = request.params as { address?: string };
  const parsed = AddressParamSchema.safeParse(address);
  if (!parsed.success) return handleBadInput(reply, parsed.error.errors[0]?.message ?? 'invalid address');

  try {
    const rep = await computeReputationScore(parsed.data);
    reply.header('Cache-Control', 'public, max-age=30');
    return reply.code(200).send({ success: true, error: null, data: rep });
  } catch (err) {
    if (err instanceof ReputationNotFoundError) {
      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          address: parsed.data.toLowerCase(),
          score: 0,
          tier: 'unseen',
          tierIcon: '·',
          summary: '· UNSEEN (0/100). This identity has no AMBER memories yet.',
          note: 'Run memory_write or memory_demo_pack to bootstrap this identity.',
          links: {
            docs: '/docs',
            onboarding: '/.well-known/amber',
          },
          generatedAt: new Date().toISOString(),
        },
      });
    }
    return handleError(
      reply,
      500,
      'reputation lookup failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

export const identityRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done
) => {
  // /identity/reputation/:address MUST be registered before /:address so that
  // the literal "reputation" segment is not treated as an address parameter.
  app.get('/reputation/:address', handleReputation);
  app.get('/:address', handleGetStats);
  done();
};
