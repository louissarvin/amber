import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { z } from 'zod';
import { x402Exact } from '../middlewares/x402Middleware.ts';
import { incrementRate } from '../services/rateLimit.ts';
import { generateSeal, getSealById, readSealSvg } from '../services/sealGenerator.ts';
import { buildTwitterCard, renderSvgToPng } from '../services/ogImageRenderer.ts';
import {
  GenerateSealBodySchema,
  GenerateSealRequestSchema,
} from '../schemas/seal.ts';
import { PRICE_SEAL_ATOMIC } from '../config/main-config.ts';
import { AmberErrorCodes, handleBadInput, handleError, handleRateLimited } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// SEALSCRIBE-lite REST — POST /seal/generate, GET /seal/:id, GET /seal/:id.svg
// -----------------------------------------------------------------------------

const zodFlat = (err: z.ZodError): string =>
  err.errors.map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`).join('; ');

const handleGenerate = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = GenerateSealRequestSchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const body = parsed.data;

  const paymentResult = await x402Exact(request, reply, {
    priceAtomic: PRICE_SEAL_ATOMIC,
    endpoint: '/seal/generate',
    identityInBody: body.identity,
    method: 'POST',
    inputSchema: GenerateSealBodySchema,
  });
  if (paymentResult === 'reply-sent') return reply;

  const rate = await incrementRate(body.identity, '/seal/generate');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const seal = await generateSeal({
      identityAddress: body.identity,
      subject: body.subject,
      decreeText: body.decreeText,
      sigilStyle: body.sigilStyle,
    });
    return reply.code(200).send({
      success: true,
      error: null,
      data: seal,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'BAD_INPUT') return handleBadInput(reply, (err as Error).message);
    return handleError(
      reply,
      500,
      'seal generation failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

const handleGetMeta = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { id } = request.params as { id?: string };
  if (!id || id.length > 64) return handleBadInput(reply, 'invalid seal id');

  try {
    const seal = await getSealById(id.replace(/\.svg$/i, ''));
    if (!seal) {
      return handleError(reply, 404, 'seal not found', AmberErrorCodes.MEMORY_NOT_FOUND);
    }
    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        sealId: seal.id,
        identity: seal.identity.address,
        subject: seal.subject,
        sigilStyle: seal.sigilStyle,
        svgPath: seal.svgPath,
        createdAt: seal.createdAt.toISOString(),
      },
    });
  } catch (err) {
    return handleError(
      reply,
      500,
      'seal lookup failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

const handleGetSvg = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { id } = request.params as { id?: string };
  if (!id) return handleBadInput(reply, 'invalid seal id');
  const sealId = id.replace(/\.svg$/i, '');

  try {
    const svg = await readSealSvg(sealId);
    if (!svg) {
      return handleError(reply, 404, 'seal not found', AmberErrorCodes.MEMORY_NOT_FOUND);
    }
    return reply
      .code(200)
      .header('Content-Type', 'image/svg+xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=86400')
      .send(svg);
  } catch (err) {
    return handleError(
      reply,
      500,
      'seal svg read failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

// GET /seal/:id/card.png — Twitter/OG 1200×630 PNG share card for a wax seal.
// Wraps the SEALSCRIBE SVG in the AMBER brand frame for shareable Social Buzz.
const handleGetCardPng = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { id } = request.params as { id?: string };
  if (!id) return handleBadInput(reply, 'invalid seal id');
  const sealId = id.replace(/\.svg$/i, '');

  try {
    const svg = await readSealSvg(sealId);
    if (!svg) {
      return handleError(reply, 404, 'seal not found', AmberErrorCodes.MEMORY_NOT_FOUND);
    }
    const seal = await getSealById(sealId);
    const inner = svg
      .replace(/^[^<]*<\?xml[^>]*>\s*/, '')
      .replace(/^<svg[^>]*>|<\/svg>\s*$/g, '');

    const cardSvg = buildTwitterCard({
      title: 'SEALSCRIBE Decree',
      subtitle: seal?.subject ?? 'On-chain wax seal minted on X Layer',
      innerSvg: inner,
      identity: seal?.identity?.address,
      stats: [
        { value: '0.05', label: 'USDT paid via x402' },
        { value: 'X Layer', label: 'chain of record' },
        { value: 'ERC-8004', label: 'identity anchor' },
      ],
    });

    const png = renderSvgToPng(cardSvg, { width: 1200, height: 630 });

    return reply
      .code(200)
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'public, max-age=86400')
      .send(png);
  } catch (err) {
    return handleError(reply, 500, 'seal card render failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

export const sealRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done
) => {
  app.post('/generate', handleGenerate);
  // The more specific `card.png` and `.svg` variants MUST register before the
  // bare :id catch-all so Fastify routes suffixes correctly.
  app.get('/:id/card.png', handleGetCardPng);
  app.get('/:id.svg', handleGetSvg);
  app.get('/:id', handleGetMeta);
  done();
};
