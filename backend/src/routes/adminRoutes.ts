import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { ADMIN_API_TOKEN } from '../config/main-config.ts';
import { buildMemoryReportCard, collectAmberStats } from '../services/metrics.ts';
import { AmberErrorCodes, handleError } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// Admin / metrics surface for Memory Report + Revenue Rocket evidence.
// Auth: Bearer ADMIN_API_TOKEN (falls back to JWT_SECRET when unset).
// -----------------------------------------------------------------------------

const unauthorized = (reply: FastifyReply) =>
  handleError(reply, 401, 'admin token required', AmberErrorCodes.IDENTITY_INVALID);

const requireAdmin = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> => {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    await unauthorized(reply);
    return false;
  }
  const token = header.slice('Bearer '.length).trim();
  const expected = ADMIN_API_TOKEN;
  if (!expected || !token) {
    await unauthorized(reply);
    return false;
  }

  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await unauthorized(reply);
    return false;
  }
  return true;
};

export const adminRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;
    const q = request.query as { windowHours?: string };
    const windowHours = Math.min(168, Math.max(1, Number(q.windowHours) || 24));
    try {
      const stats = await collectAmberStats(windowHours);
      return reply.code(200).send({ success: true, error: null, data: stats });
    } catch (err) {
      return handleError(reply, 500, 'stats failed', AmberErrorCodes.INTERNAL, err as Error);
    }
  });

  app.get('/memory-report', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;
    const q = request.query as { windowHours?: string };
    const windowHours = Math.min(168, Math.max(1, Number(q.windowHours) || 24));
    try {
      const card = await buildMemoryReportCard(windowHours);
      return reply.code(200).send({ success: true, error: null, data: card });
    } catch (err) {
      return handleError(
        reply,
        500,
        'memory report failed',
        AmberErrorCodes.INTERNAL,
        err as Error
      );
    }
  });

  done();
};
