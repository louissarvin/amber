import type { FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { redis } from '../lib/redis.ts';
import { IS_DEV } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// Error code catalog (all AMBER errors go through handleError with one of these)
// Existing starter codes: VALIDATION_ERROR, NOT_FOUND, UNAUTHORIZED, FORBIDDEN,
// DATABASE_ERROR, INTERNAL_ERROR, MISSING_AUTH_HEADER, TOKEN_MISSING,
// INVALID_TOKEN, INVALID_TOKEN_PAYLOAD, USER_NOT_FOUND.
// AMBER additions below are declared here so grep can find them all in one
// place. The handler itself is stringly-typed so any new code compiles.
// -----------------------------------------------------------------------------
export const AmberErrorCodes = {
  BAD_INPUT: 'BAD_INPUT',
  IDENTITY_MISSING: 'IDENTITY_MISSING',
  IDENTITY_INVALID: 'IDENTITY_INVALID',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  PAYMENT_INVALID: 'PAYMENT_INVALID',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  MEMORY_NOT_FOUND: 'MEMORY_NOT_FOUND',
  MEMORY_FORBIDDEN: 'MEMORY_FORBIDDEN',
  MEMORY_INJECTION_REJECTED: 'MEMORY_INJECTION_REJECTED',
  SEMANTIC_INDEX_UNAVAILABLE: 'SEMANTIC_INDEX_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  ORIGIN_REJECTED: 'ORIGIN_REJECTED',
  MCP_SESSION_INVALID: 'MCP_SESSION_INVALID',
  INTERNAL: 'INTERNAL',
} as const;

export type AmberErrorCode = (typeof AmberErrorCodes)[keyof typeof AmberErrorCodes];

interface ErrorContext {
  [key: string]: unknown;
}

export interface HandleErrorOptions {
  // When true, do not persist the `context` field to the ErrorLog row.
  // Response contract is unchanged (dev still gets details in the response
  // body via IS_DEV). Use for pre-auth failures where context may include
  // unauthenticated payer data.
  skipContextPersistence?: boolean;
}

const ERROR_DEDUPE_TTL_SECONDS = 60;

// Best-effort dedupe of ErrorLog DB writes. Redis SET NX EX 60 — only the
// first hit within a 60s window per (errorCode, path, ip) writes to the DB.
// If Redis is unavailable we fail open (write anyway). The ErrorLog worker
// caps at 10k rows regardless.
const shouldPersistErrorLog = async (
  errorCode: string,
  path: string | undefined,
  ip: string | null | undefined
): Promise<boolean> => {
  try {
    const key = `errlog:${errorCode}:${path ?? ''}:${ip ?? ''}`;
    const result = await redis.set(key, '1', 'EX', ERROR_DEDUPE_TTL_SECONDS, 'NX');
    return result === 'OK';
  } catch {
    // Redis unavailable — fail open. Cleanup worker will cap at 10k.
    return true;
  }
};

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: string;
    stack?: string;
  };
  data: null;
  timestamp?: string;
}

/**
 * Main error handler - logs to database and returns standardized error response
 */
export const handleError = async (
  reply: FastifyReply,
  statusCode: number,
  message: string,
  errorCode: string,
  originalError: Error | null = null,
  context: ErrorContext | null = null,
  options: HandleErrorOptions = {}
): Promise<FastifyReply> => {
  try {
    const request = reply.request;
    const userId = (request as { user?: { id: string } }).user?.id || null;

    // Extract request information
    const rawIp = request.ip || request.headers['x-forwarded-for'] || request.socket?.remoteAddress || null;
    const ip = Array.isArray(rawIp) ? rawIp[0] : rawIp;
    const requestInfo = {
      method: request.method,
      path: request.url,
      userAgent: request.headers['user-agent'] || null,
      ip,
    };

    // Prepare error log data. When skipContextPersistence is set (pre-auth
    // failures), omit the context field from the DB row. Response body is
    // unchanged.
    const errorLogData = {
      errorCode,
      message,
      statusCode,
      stack: originalError?.stack || null,
      context: options.skipContextPersistence
        ? null
        : context
          ? JSON.stringify(context)
          : null,
      userId,
      ...requestInfo,
    };

    // Redis-backed dedupe: only persist the first ErrorLog per
    // (errorCode, path, ip) per 60s window. Fail open on Redis error.
    const shouldPersist = await shouldPersistErrorLog(errorCode, requestInfo.path, ip);
    if (shouldPersist) {
      // Log to database (non-blocking)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((prismaQuery as any).errorLog as { create: (args: { data: typeof errorLogData }) => Promise<unknown> })
        .create({
          data: errorLogData,
        })
        .catch((dbError: unknown) => {
          console.error('Failed to log error to database:', dbError);
        });
    }

    // Log to console for development
    console.error(`[${errorCode}] ${message}`, {
      statusCode,
      userId,
      path: requestInfo.path,
      method: requestInfo.method,
      originalError: originalError?.message,
      stack: originalError?.stack,
    });

    // Send standardized error response
    const response: ErrorResponse = {
      success: false,
      error: {
        code: errorCode,
        message,
        ...(IS_DEV &&
          originalError && {
            details: originalError.message,
            stack: originalError.stack,
          }),
      },
      data: null,
      timestamp: new Date().toISOString(),
    };

    return reply.code(statusCode).send(response);
  } catch (handlerError) {
    console.error('Error in error handler:', handlerError);

    // Fallback response if error handler fails
    return reply.code(statusCode).send({
      success: false,
      error: {
        code: errorCode,
        message,
      },
      data: null,
    });
  }
};

/**
 * Handle validation errors (missing/invalid fields)
 */
export const handleValidationError = (reply: FastifyReply, missingFields: string[]): Promise<FastifyReply> => {
  return handleError(reply, 400, `Missing required fields: ${missingFields.join(', ')}`, 'VALIDATION_ERROR', null, {
    missingFields,
  });
};

/**
 * Handle resource not found errors
 */
export const handleNotFoundError = (reply: FastifyReply, resource: string): Promise<FastifyReply> => {
  return handleError(reply, 404, `${resource} not found`, 'NOT_FOUND', null, { resource });
};

/**
 * Handle unauthorized errors (401)
 */
export const handleUnauthorizedError = (reply: FastifyReply, reason: string = 'Unauthorized'): Promise<FastifyReply> => {
  return handleError(reply, 401, reason, 'UNAUTHORIZED');
};

/**
 * Handle forbidden errors (403)
 */
export const handleForbiddenError = (reply: FastifyReply, reason: string = 'Forbidden'): Promise<FastifyReply> => {
  return handleError(reply, 403, reason, 'FORBIDDEN');
};

/**
 * Handle database errors
 */
export const handleDatabaseError = (
  reply: FastifyReply,
  operation: string,
  originalError: Error
): Promise<FastifyReply> => {
  return handleError(reply, 500, `Database error during ${operation}`, 'DATABASE_ERROR', originalError, { operation });
};

/**
 * Handle internal server errors
 */
export const handleServerError = (reply: FastifyReply, originalError: Error): Promise<FastifyReply> => {
  return handleError(reply, 500, 'Internal server error', 'INTERNAL_ERROR', originalError);
};

// -----------------------------------------------------------------------------
// AMBER convenience helpers
// -----------------------------------------------------------------------------

export const handleBadInput = (
  reply: FastifyReply,
  message: string,
  context: ErrorContext | null = null
): Promise<FastifyReply> => {
  return handleError(reply, 400, message, AmberErrorCodes.BAD_INPUT, null, context);
};

export const handleRateLimited = (
  reply: FastifyReply,
  retryAfterSeconds: number = 60
): Promise<FastifyReply> => {
  reply.header('Retry-After', String(retryAfterSeconds));
  return handleError(reply, 429, 'Rate limit exceeded', AmberErrorCodes.RATE_LIMITED, null, {
    retryAfterSeconds,
  });
};

export const handleAmberInternal = (
  reply: FastifyReply,
  message: string,
  originalError: Error | null = null,
  context: ErrorContext | null = null
): Promise<FastifyReply> => {
  return handleError(reply, 500, message, AmberErrorCodes.INTERNAL, originalError, context);
};
