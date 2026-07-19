import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  MCP_ALLOWED_ORIGINS,
  MCP_ALLOW_ANY_ORIGIN,
} from '../config/main-config.ts';
import { AmberErrorCodes, handleError } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// Origin allowlist for the /mcp transport (DNS-rebinding defense).
//
// Wildcard support: an entry like `https://*.okx.ai` matches anything under
// okx.ai. Custom-scheme entries like `claude://*` match any URL with the
// given scheme (used for native desktop clients).
//
// Important: server-side MCP clients and onchainos CLI often
// do NOT send an Origin header. Browsers do send Origin / Sec-Fetch-* on
// cross-site script requests, so we enforce the allowlist when Origin exists
// and reject browser-like requests that omit it. Plain server-to-server
// requests without browser fetch metadata are allowed.
//
// In dev only, MCP_ALLOW_ANY_ORIGIN=true bypasses. Never enable in prod.
// -----------------------------------------------------------------------------

const matches = (origin: string, pattern: string): boolean => {
  if (pattern === origin) return true;
  if (pattern.endsWith('://*')) {
    const scheme = pattern.slice(0, -3); // "claude://"
    return origin.startsWith(scheme);
  }
  const wildcardIdx = pattern.indexOf('*');
  if (wildcardIdx === -1) return false;
  const prefix = pattern.slice(0, wildcardIdx);
  const suffix = pattern.slice(wildcardIdx + 1);
  return origin.startsWith(prefix) && origin.endsWith(suffix);
};

export const originAllowlistMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<true | FastifyReply> => {
  if (MCP_ALLOW_ANY_ORIGIN) return true;

  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin.length === 0) {
    const hasBrowserFetchMetadata =
      typeof request.headers['sec-fetch-site'] === 'string' ||
      typeof request.headers['sec-fetch-mode'] === 'string' ||
      typeof request.headers['sec-fetch-dest'] === 'string';
    if (!hasBrowserFetchMetadata) return true;

    return handleError(reply, 403, 'Browser Origin header required', AmberErrorCodes.ORIGIN_REJECTED);
  }
  for (const pattern of MCP_ALLOWED_ORIGINS) {
    if (matches(origin, pattern)) return true;
  }
  return handleError(reply, 403, `Origin not allowed: ${origin}`, AmberErrorCodes.ORIGIN_REJECTED);
};
