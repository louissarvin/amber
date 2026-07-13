import { prismaQuery } from './prisma.ts';
import { redis } from './redis.ts';

// -----------------------------------------------------------------------------
// MCP session storage — hot (Redis) + durable (Postgres McpSession).
//
// Session id is a v4 UUID (ASCII 0x21-0x7E, per MCP spec). TTL 1h; refreshed
// on every use.
// -----------------------------------------------------------------------------

const SESSION_TTL_SECONDS = 60 * 60; // 1h

export interface McpSessionData {
  id: string;
  identityAddress: string | null;
  origin: string;
  protocolVersion: string;
  clientName: string | null;
  clientVersion: string | null;
}

const key = (sessionId: string): string => `mcp:session:${sessionId}`;

export const createSession = async (data: McpSessionData): Promise<void> => {
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await prismaQuery.mcpSession.create({
    data: {
      id: data.id,
      identityId: null, // filled once we tie a payment identity to the session
      origin: data.origin,
      protocolVersion: data.protocolVersion,
      clientName: data.clientName,
      clientVersion: data.clientVersion,
      expiresAt,
    },
  });

  try {
    await redis
      .multi()
      .hset(key(data.id), {
        identityAddress: data.identityAddress ?? '',
        origin: data.origin,
        protocolVersion: data.protocolVersion,
        clientName: data.clientName ?? '',
        clientVersion: data.clientVersion ?? '',
      })
      .expire(key(data.id), SESSION_TTL_SECONDS)
      .exec();
  } catch (err) {
    console.warn('[mcpSession] redis create failed:', (err as Error).message);
  }
};

export const touchSession = async (sessionId: string): Promise<McpSessionData | null> => {
  // Hot path.
  try {
    const cached = await redis.hgetall(key(sessionId));
    if (cached && cached.origin) {
      await redis.expire(key(sessionId), SESSION_TTL_SECONDS);
      return {
        id: sessionId,
        identityAddress: cached.identityAddress || null,
        origin: cached.origin,
        protocolVersion: cached.protocolVersion,
        clientName: cached.clientName || null,
        clientVersion: cached.clientVersion || null,
      };
    }
  } catch (err) {
    console.warn('[mcpSession] redis lookup failed:', (err as Error).message);
  }

  // Cold path — Postgres fallback.
  const row = await prismaQuery.mcpSession.findUnique({ where: { id: sessionId } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  await prismaQuery.mcpSession.update({
    where: { id: sessionId },
    data: { expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) },
  });
  return {
    id: sessionId,
    identityAddress: null,
    origin: row.origin,
    protocolVersion: row.protocolVersion,
    clientName: row.clientName,
    clientVersion: row.clientVersion,
  };
};
