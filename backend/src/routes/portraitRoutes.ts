import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { handleBadInput, handleError, AmberErrorCodes } from '../utils/errorHandler.ts';
import { PUBLIC_BASE_URL } from '../config/main-config.ts';
import { prismaQuery } from '../lib/prisma.ts';
import {
  getOrGeneratePortrait,
  TIMELAPSE_MIN_FRAMES,
  TIMELAPSE_MAX_FRAMES,
} from '../services/portraitService.ts';
import { buildTwitterCard, renderSvgToPng } from '../services/ogImageRenderer.ts';
import { computeReputationScore, ReputationNotFoundError } from '../services/reputationScore.ts';

// -----------------------------------------------------------------------------
// Memory Portrait REST — free endpoints for the visual identity constellation.
//   GET /portrait/:address       -> JSON metadata (address, svgUrl, count)
//   GET /portrait/:address.svg   -> raw SVG (Content-Type: image/svg+xml)
// -----------------------------------------------------------------------------

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const handleGetMeta = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { address } = request.params as { address?: string };
  if (!address || !ADDRESS_RE.test(address)) {
    return handleBadInput(reply, 'invalid address');
  }

  const normalized = address.toLowerCase();

  try {
    const identity = await prismaQuery.identity.findFirst({
      where: { address: normalized },
    });
    if (!identity) {
      return handleError(
        reply,
        404,
        'portrait not found',
        AmberErrorCodes.MEMORY_NOT_FOUND
      );
    }

    const totalMemories = await prismaQuery.memory.count({
      where: { identityId: identity.id, deletedAt: null },
    });
    if (totalMemories === 0) {
      return handleError(
        reply,
        404,
        'portrait not found',
        AmberErrorCodes.MEMORY_NOT_FOUND
      );
    }

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        address: normalized,
        svgUrl: `${PUBLIC_BASE_URL}/portrait/${normalized}.svg`,
        totalMemories,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleError(
      reply,
      500,
      'portrait lookup failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

const handleGetSvg = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { address: raw } = request.params as { address?: string };
  if (!raw) return handleBadInput(reply, 'invalid address');

  const address = raw.replace(/\.svg$/i, '');
  if (!ADDRESS_RE.test(address)) {
    return handleBadInput(reply, 'invalid address');
  }

  // Optional timelapse mode: ?frames=N replays the identity's lifetime as an
  // animated constellation. Absent -> classic single-frame render (unchanged).
  const { frames: framesRaw } = request.query as { frames?: string };
  let frames: number | undefined;
  if (framesRaw !== undefined) {
    const n = Number(framesRaw);
    if (
      !Number.isInteger(n) ||
      n < TIMELAPSE_MIN_FRAMES ||
      n > TIMELAPSE_MAX_FRAMES
    ) {
      return handleBadInput(
        reply,
        `frames must be an integer between ${TIMELAPSE_MIN_FRAMES} and ${TIMELAPSE_MAX_FRAMES}`
      );
    }
    frames = n;
  }

  try {
    const svg = await getOrGeneratePortrait(address, frames);
    if (!svg) {
      return handleError(
        reply,
        404,
        'portrait not found',
        AmberErrorCodes.MEMORY_NOT_FOUND
      );
    }
    return reply
      .code(200)
      .header('Content-Type', 'image/svg+xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(svg);
  } catch (err) {
    return handleError(
      reply,
      500,
      'portrait render failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

// GET /portrait/:address/card.png — Twitter/OG-sized 1200×630 PNG card.
// Wraps the constellation portrait in the AMBER brand frame and adds the
// live reputation score + memory count as stats. Cached 5 minutes.
const handleGetCardPng = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { address } = request.params as { address?: string };
  if (!address || !ADDRESS_RE.test(address)) {
    return handleBadInput(reply, 'invalid address');
  }

  const normalized = address.toLowerCase();

  try {
    const portraitSvg = await getOrGeneratePortrait(normalized);
    if (!portraitSvg) {
      return handleError(reply, 404, 'portrait not found', AmberErrorCodes.MEMORY_NOT_FOUND);
    }

    // Strip the outer <svg> wrapper from the source portrait so we can inline
    // its contents inside our OG card frame. resvg does not accept nested
    // <svg> elements without matching viewBox, so this keeps rendering fast.
    const inner = portraitSvg.replace(/^[^<]*<\?xml[^>]*>\s*/, '').replace(/^<svg[^>]*>|<\/svg>\s*$/g, '');

    let reputationLine: string | undefined;
    let stats: Array<{ label: string; value: string }> = [];
    try {
      const rep = await computeReputationScore(normalized);
      reputationLine = `${rep.tierIcon} ${rep.tier.toUpperCase()} · ${rep.score}/100`;
      stats = [
        { value: `${rep.score}`, label: '/ 100 reputation' },
        { value: `${rep.totalMemories}`, label: 'memories persisted' },
        { value: rep.attestationRate, label: 'Merkle-attested on X Layer' },
        { value: `${rep.breakdown.breadth.verticalsUsed.length}/5`, label: 'OKX AI verticals covered' },
      ];
    } catch (err) {
      if (!(err instanceof ReputationNotFoundError)) throw err;
      reputationLine = 'Fresh identity — no memories yet';
    }

    const cardSvg = buildTwitterCard({
      title: 'Memory Portrait',
      subtitle: reputationLine,
      innerSvg: inner,
      identity: normalized,
      stats,
    });

    const png = renderSvgToPng(cardSvg, { width: 1200, height: 630 });

    return reply
      .code(200)
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'public, max-age=300')
      .send(png);
  } catch (err) {
    return handleError(reply, 500, 'portrait card render failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

export const portraitRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done
) => {
  // Register the `.svg` and `card.png` variants BEFORE the bare `:address`
  // catch-all so Fastify routes the more specific suffix matches first.
  app.get('/:address/card.png', handleGetCardPng);
  app.get('/:address.svg', handleGetSvg);
  app.get('/:address', handleGetMeta);
  done();
};
