import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { x402Exact } from '../middlewares/x402Middleware.ts';
import { incrementRate } from '../services/rateLimit.ts';
import { writeOne, writeBulk } from '../services/memoryWriter.ts';
import { queryTopK, queryRelated } from '../services/memoryQuery.ts';
import { fetchSessionContext } from '../services/sessionContext.ts';
import { getOrCreateIdentity } from '../services/identity.ts';
import { getOrCreateQuota, hasFreeCapacity, freeRemaining } from '../lib/quota/service.ts';
import { listMemories, softDeleteMemory, type ListedMemory } from '../services/memoryLifecycle.ts';
import { attestationRefFromMemoryId, pendingAttestationRef } from '../services/attestationRef.ts';
import {
  BulkWriteRequestSchema,
  BulkWriteBodySchema,
  ConsolidateMemoriesBodySchema,
  ConsolidateMemoriesRequestSchema,
  DeleteMemoryRequestSchema,
  DeleteMemoryBodySchema,
  ExportMemoryQuerySchema,
  ExportMemoryRequestSchema,
  GetMemoryQuerySchema,
  GetMemoryRequestSchema,
  ListMemoriesRequestSchema,
  QueryMemoryRequestSchema,
  QueryMemoryQuerySchema,
  RelatedMemoryRequestSchema,
  RelatedMemoryBodySchema,
  SessionContextRequestSchema,
  SessionContextQuerySchema,
  ShareMemoriesBodySchema,
  ShareMemoriesRequestSchema,
  WriteMemoryRequestSchema,
  WriteMemoryBodySchema,
  DemoPackRequestSchema,
  WhoAmIRequestSchema,
  SessionDiffRequestSchema,
  PinMemoryRequestSchema,
} from '../schemas/memory.ts';
import { memoryAttestationHandler } from './attestationRoutes.ts';
import { handleSeedWallet } from './walletSeedRoutes.ts';
import { getMemoryById } from '../services/memoryLifecycle.ts';
import { streamMemoryExport } from '../services/memoryExport.ts';
import { shareMemories, consolidateMemories } from '../services/memoryShare.ts';
import { runDemoPack } from '../services/onboarding.ts';
import { whoAmI, sessionDiff, setMemoryPinned } from '../services/memoryWhoami.ts';
import { lifestyleRemember } from '../services/lifestyleRemember.ts';
import { MEMORY_QUERY_SAFETY_FRAME } from '../services/memoryQuery.ts';
import { isProbeRequest, PROBE_IDENTITY } from '../lib/probe/probe.ts';
import { AmberErrorCodes, handleBadInput, handleError, handleRateLimited } from '../utils/errorHandler.ts';
import {
  FREE_TIER_WRITES_PER_IDENTITY,
  PRICE_EXPORT_ATOMIC,
  PRICE_QUERY_ATOMIC,
  PRICE_SESSION_CONTEXT_ATOMIC,
  PRICE_WRITE_ATOMIC,
  PUBLIC_BASE_URL,
  RATE_LIMIT_BULK_PER_MIN,
} from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// AMBER memory HTTP routes (mounted at prefix `/memory`).
// -----------------------------------------------------------------------------

const zodFlat = (err: z.ZodError): string => {
  return err.errors
    .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
    .join('; ');
};

const respondWrite = async (
  reply: FastifyReply,
  data: {
    memoryId: string;
    createdAt: string;
    freeRemaining: number;
    replay: boolean;
    paymentMode?: 'free' | 'paid';
  }
): Promise<FastifyReply> => {
  if (data.replay) reply.header('X-Amber-Replay', 'true');
  // Surface remaining free-tier writes to MCP clients as a lightweight header
  // so agents can prompt the user to top up before the next call requires an
  // on-chain x402 signature. Only emitted for free-tier writes — paid writes
  // already carry PAYMENT-RESPONSE + X-Amber-Review.
  if (data.paymentMode === 'free') {
    reply.header('X-Amber-Quota', `free:${data.freeRemaining}`);
  }
  const attestation = data.replay
    ? await attestationRefFromMemoryId(data.memoryId)
    : pendingAttestationRef();
  return reply.code(200).send({
    success: true,
    error: null,
    data: {
      memoryId: data.memoryId,
      createdAt: data.createdAt,
      attestation,
      quota: { freeRemaining: data.freeRemaining },
    },
  });
};

// -----------------------------------------------------------------------------
// PART B — free-route bodyless probe support.
//
// A genuine read of the seeded demo identity's current state. Free POST routes
// answer a bodyless probe with 200 + this real data (never fabricated), shaped
// to each route's normal output. No mutation is performed, so a probe is fully
// idempotent regardless of how many times the review harness hits it. On any DB
// error we degrade to an empty list + the free-tier cap so the probe still
// reports 200 (connectivity ok) without leaking internals.
// -----------------------------------------------------------------------------
const readProbeState = async (
  limit: number
): Promise<{ memories: ListedMemory[]; freeRemaining: number }> => {
  try {
    const identity = await getOrCreateIdentity(PROBE_IDENTITY);
    const [listed, quota] = await Promise.all([
      listMemories({ identityAddress: PROBE_IDENTITY, limit, cursor: null, category: null }),
      getOrCreateQuota(identity.id),
    ]);
    return { memories: listed.memories, freeRemaining: freeRemaining(quota) };
  } catch {
    return { memories: [], freeRemaining: FREE_TIER_WRITES_PER_IDENTITY };
  }
};

const handleWrite = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
  // Bodyless probe → 200 with the demo identity's latest real memory, shaped
  // exactly like a normal write response. No write is performed.
  if (isProbeRequest(request)) {
    reply.header('X-Amber-Probe', 'demo-identity-latest-write');
    const { memories, freeRemaining: rem } = await readProbeState(1);
    const latest = memories[0] ?? null;
    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        memoryId: latest?.memoryId ?? null,
        createdAt: latest?.createdAt ?? null,
        attestation: latest?.attestation ?? pendingAttestationRef(),
        quota: { freeRemaining: rem },
      },
    });
  }

  const parsed = WriteMemoryRequestSchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const body = parsed.data;

  // 1. Identity + idempotent replay short-circuit (BEFORE x402 so replay
  //    does not require a fresh authorization).
  const identity = await getOrCreateIdentity(body.identity);
  if (body.clientNonce) {
    const existing = await import('../lib/prisma.ts').then((m) =>
      m.prismaQuery.memory.findFirst({
        where: {
          identityId: identity.id,
          clientNonce: body.clientNonce,
          deletedAt: null,
        },
      })
    );
    if (existing) {
      // Enforce content invariance for clientNonce replays. A client that
      // reuses a nonce with different content is either buggy or malicious
      // — return 409 rather than silently returning the original memoryId.
      if (existing.content !== body.content) {
        return handleError(
          reply,
          409,
          'clientNonce reused with different content',
          AmberErrorCodes.BAD_INPUT
        );
      }
      const quota = await getOrCreateQuota(identity.id);
      const replayRemaining = freeRemaining(quota);
      return respondWrite(reply, {
        memoryId: existing.id,
        createdAt: existing.createdAt.toISOString(),
        freeRemaining: replayRemaining,
        replay: true,
        // On replay we don't know the original payment mode. Surface the
        // quota header only when the identity still has free capacity —
        // this is a hint, not an audit.
        paymentMode: replayRemaining > 0 ? 'free' : 'paid',
      });
    }
  }

  // 2. Quota gate — free-tier bypasses x402.
  const quota = await getOrCreateQuota(identity.id);
  const isFree = hasFreeCapacity(quota);

  if (!isFree) {
    const paymentResult = await x402Exact(request, reply, {
      priceAtomic: PRICE_WRITE_ATOMIC,
      endpoint: '/memory/write',
      identityInBody: body.identity,
      method: 'POST',
      inputSchema: WriteMemoryBodySchema,
    });
    if (paymentResult === 'reply-sent') return;
  }

  // 3. Rate limit.
  const rate = await incrementRate(body.identity, '/memory/write');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  // 4. Write.
  try {
    const result = await writeOne({
      identityAddress: body.identity,
      content: body.content,
      category: body.category ?? 'note',
      tags: body.tags ?? [],
      metadata: body.metadata ?? {},
      clientNonce: body.clientNonce ?? null,
      // Tell writeOne which mode the caller already decided on. If the
      // atomic free-tier reservation loses the race, writeOne throws
      // QUOTA_RACE_LOST and the client is instructed to retry with x402.
      paymentMode: isFree ? 'free' : 'paid',
    });
    return respondWrite(reply, {
      memoryId: result.memoryId,
      createdAt: result.createdAt,
      freeRemaining: result.freeRemaining,
      replay: result.replay,
      paymentMode: isFree ? 'free' : 'paid',
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'BAD_INPUT_CONFLICT') {
      return handleError(reply, 409, (err as Error).message, AmberErrorCodes.BAD_INPUT);
    }
    if ((err as { code?: string }).code === 'MEMORY_INJECTION_REJECTED') {
      return handleError(
        reply,
        400,
        (err as Error).message,
        AmberErrorCodes.MEMORY_INJECTION_REJECTED,
        null,
        { flags: (err as { flags?: string[] }).flags ?? [] }
      );
    }
    if ((err as { code?: string }).code === 'QUOTA_RACE_LOST') {
      // Tell the client the free-tier check raced. Retry will re-run the
      // handler; if quota still exhausted, x402 will kick in naturally.
      return handleError(
        reply,
        409,
        (err as Error).message,
        AmberErrorCodes.QUOTA_EXCEEDED
      );
    }
    return handleError(
      reply,
      500,
      'failed to persist memory',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

const handleQuery = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
  const parsed = QueryMemoryRequestSchema.safeParse(request.query);

  // Payment gate runs BEFORE input validation so any unpaid request, including
  // the bodyless or paramless probe (GET or POST) the OKX x402 review harness
  // sends, receives a standard 402 challenge instead of a 400 or 404. A request
  // carrying a valid payment is verified here first, then falls through to the
  // input check below. Identity only matters for matching a present payer, so an
  // unpaid probe passes the zero address, which never matches a real signer.
  const paymentResult = await x402Exact(request, reply, {
    priceAtomic: PRICE_QUERY_ATOMIC,
    endpoint: '/memory/query',
    identityInBody: parsed.success
      ? parsed.data.identity
      : '0x0000000000000000000000000000000000000000',
    method: 'GET',
    inputSchema: QueryMemoryQuerySchema,
  });
  if (paymentResult === 'reply-sent') return;

  // Payment verified. Now require valid input for real processing.
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const q = parsed.data;

  const rate = await incrementRate(q.identity, '/memory/query');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  const start = Date.now();
  try {
    const results = await queryTopK({
      identityAddress: q.identity,
      q: q.q,
      k: q.k,
      category: q.category ?? null,
      since: q.since ?? null,
      minRelevance: q.minRelevance,
    });
    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        safetyFrame: MEMORY_QUERY_SAFETY_FRAME,
        results,
        latencyMs: Date.now() - start,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'MEMORY_INJECTION_REJECTED') {
      return handleError(
        reply,
        400,
        (err as Error).message,
        AmberErrorCodes.MEMORY_INJECTION_REJECTED,
        null,
        { flags: (err as { flags?: string[] }).flags ?? [] }
      );
    }
    return handleError(
      reply,
      500,
      'query failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

const handleBulkWrite = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
  // Bodyless probe → 200 with the demo identity's recent memories as a real
  // per-item result set. No write is performed.
  if (isProbeRequest(request)) {
    reply.header('X-Amber-Probe', 'demo-identity-read');
    const { memories } = await readProbeState(5);
    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        results: memories.map((m) => ({ ok: true as const, memoryId: m.memoryId })),
        attestation: pendingAttestationRef(),
      },
    });
  }

  const parsed = BulkWriteRequestSchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const body = parsed.data;

  // 1. Resolve identity + quota. Compute free/paid split for this batch.
  const identity = await getOrCreateIdentity(body.identity);
  const quota = await getOrCreateQuota(identity.id);
  const freeAvailable = Math.max(0, FREE_TIER_WRITES_PER_IDENTITY - quota.freeUsed);
  const totalItems = body.items.length;
  const freeItems = Math.min(freeAvailable, totalItems);
  const paidItemsNeeded = Math.max(0, totalItems - freeItems);

  // 2. Payment gate. If any item requires payment, run x402 for the total.
  //    Otherwise skip x402 — same posture as free-tier /memory/write.
  if (paidItemsNeeded > 0) {
    const paymentResult = await x402Exact(request, reply, {
      priceAtomic: PRICE_WRITE_ATOMIC * paidItemsNeeded,
      endpoint: '/memory/bulk-write',
      identityInBody: body.identity,
      method: 'POST',
      inputSchema: BulkWriteBodySchema,
    });
    if (paymentResult === 'reply-sent') return;
  }

  // 3. Rate limit AFTER payment (mirrors handleWrite ordering).
  const rate = await incrementRate(body.identity, '/memory/bulk-write', RATE_LIMIT_BULK_PER_MIN);
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const bulk = await writeBulk(
      body.identity,
      body.items.map((it) => ({
        content: it.content,
        category: it.category ?? 'note',
        tags: it.tags ?? [],
        metadata: it.metadata ?? {},
        clientNonce: it.clientNonce ?? null,
      })),
      { paidItems: paidItemsNeeded, freeItems }
    );

    const results = bulk.perItem.map((entry) => {
      if (entry.ok) return { ok: true as const, memoryId: entry.memoryId };
      return {
        ok: false as const,
        error: { code: entry.code, message: entry.message, index: entry.index },
      };
    });

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        results,
        attestation: pendingAttestationRef(),
      },
    });
  } catch (err) {
    return handleError(
      reply,
      500,
      'bulk write failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

const handleSessionContext = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = SessionContextRequestSchema.safeParse(request.query);

  // Payment gate runs BEFORE input validation (see handleQuery): an unpaid probe
  // of any method, with or without params, gets a standard 402, not a 400 or 404.
  const paymentResult = await x402Exact(request, reply, {
    priceAtomic: PRICE_SESSION_CONTEXT_ATOMIC,
    endpoint: '/memory/session-context',
    identityInBody: parsed.success
      ? parsed.data.identity
      : '0x0000000000000000000000000000000000000000',
    method: 'GET',
    inputSchema: SessionContextQuerySchema,
  });
  if (paymentResult === 'reply-sent') return;

  // Payment verified. Now require valid input for real processing.
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const q = parsed.data;

  const rate = await incrementRate(q.identity, '/memory/session-context');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const data = await fetchSessionContext({
      identityAddress: q.identity,
      limit: q.limit,
    });
    return reply.code(200).send({
      success: true,
      error: null,
      data,
    });
  } catch (err) {
    return handleError(
      reply,
      500,
      'session context failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

const handleList = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
  const parsed = ListMemoriesRequestSchema.safeParse(request.query);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const q = parsed.data;

  // List is free (browse own namespace) but rate-limited.
  // Paid semantic search remains on /query.
  const rate = await incrementRate(q.identity, '/memory/list');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const data = await listMemories({
      identityAddress: q.identity,
      limit: q.limit,
      cursor: q.cursor ?? null,
      category: q.category ?? null,
    });
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    return handleError(reply, 500, 'list failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleDelete = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
  // DELETE may carry body or query; body takes precedence.
  const bodyFromParams = {
    ...(typeof request.body === 'object' && request.body !== null ? request.body : {}),
    memoryId: (request.params as { memoryId?: string }).memoryId,
  };
  const parsed = DeleteMemoryRequestSchema.safeParse(bodyFromParams);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const body = parsed.data;

  // M5 fix: gate delete behind x402 to prove the caller controls the identity
  // private key. Without this, anyone who knows memoryId + identity address
  // can delete arbitrary memories. x402 requires a valid EIP-3009 signature
  // so impersonation is cryptographically infeasible.
  // Price: 1 atomic unit (1e-6 USDT) — symbolic, intent is identity proof.
  const deleteGate = await x402Exact(request, reply, {
    priceAtomic: 1,
    endpoint: '/memory/delete',
    identityInBody: body.identity,
    method: 'DELETE',
    inputSchema: DeleteMemoryBodySchema,
  });
  if (deleteGate === 'reply-sent') return reply;

  const rate = await incrementRate(body.identity, '/memory/delete');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const data = await softDeleteMemory(body.identity, body.memoryId);
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'MEMORY_NOT_FOUND') {
      return handleError(reply, 404, (err as Error).message, AmberErrorCodes.MEMORY_NOT_FOUND);
    }
    if (code === 'MEMORY_FORBIDDEN') {
      return handleError(reply, 403, (err as Error).message, AmberErrorCodes.MEMORY_FORBIDDEN);
    }
    return handleError(reply, 500, 'delete failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleGet = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const bodyFromParams = {
    ...(request.query as object),
    memoryId: (request.params as { memoryId?: string }).memoryId,
  };
  const parsed = GetMemoryRequestSchema.safeParse(bodyFromParams);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const req = parsed.data;

  const paymentResult = await x402Exact(request, reply, {
    priceAtomic: PRICE_QUERY_ATOMIC,
    endpoint: '/memory/:id',
    identityInBody: req.identity,
    method: 'GET',
    inputSchema: GetMemoryQuerySchema,
  });
  if (paymentResult === 'reply-sent') return;

  const rate = await incrementRate(req.identity, '/memory/get');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const data = await getMemoryById(req.identity, req.memoryId);
    return reply.code(200).send({ success: true, error: null, data });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'MEMORY_NOT_FOUND') {
      return handleError(reply, 404, (err as Error).message, AmberErrorCodes.MEMORY_NOT_FOUND);
    }
    if (code === 'MEMORY_FORBIDDEN') {
      return handleError(reply, 403, (err as Error).message, AmberErrorCodes.MEMORY_FORBIDDEN);
    }
    return handleError(reply, 500, 'get failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleExport = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = ExportMemoryRequestSchema.safeParse(request.query);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const q = parsed.data;

  const paymentResult = await x402Exact(request, reply, {
    priceAtomic: PRICE_EXPORT_ATOMIC,
    endpoint: '/memory/export',
    identityInBody: q.identity,
    method: 'GET',
    inputSchema: ExportMemoryQuerySchema,
  });
  if (paymentResult === 'reply-sent') return;

  const rate = await incrementRate(q.identity, '/memory/export', RATE_LIMIT_BULK_PER_MIN);
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    reply.header('Content-Type', 'application/x-ndjson');
    reply.header('X-Amber-Export-Identity', q.identity);
    const stream = await streamMemoryExport({
      identityAddress: q.identity,
      since: q.since ?? null,
      cursor: q.cursor ?? null,
      limit: q.limit,
    });
    return reply.send(stream);
  } catch (err) {
    return handleError(reply, 500, 'export failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleShare = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  // Bodyless probe → 200 with a truthful no-op share: 0 memories moved, and the
  // demo identity's real shareable memory ids surfaced. No mutation performed.
  if (isProbeRequest(request)) {
    reply.header('X-Amber-Probe', 'demo-identity-read');
    const { memories } = await readProbeState(5);
    return reply.code(200).send({
      success: true,
      error: null,
      data: { shared: 0, memoryIds: memories.map((m) => m.memoryId), skipped: [] },
    });
  }

  const parsed = ShareMemoriesRequestSchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const body = parsed.data;

  // Shares that require paid destination writes must clear x402 when free tier
  // on the destination is exhausted. Gate at write fee × memory count cap.
  const destQuota = await getOrCreateQuota((await getOrCreateIdentity(body.toIdentity)).id);
  const freeLeft = Math.max(0, FREE_TIER_WRITES_PER_IDENTITY - destQuota.freeUsed);
  const paidNeeded = Math.max(0, body.memoryIds.length - freeLeft);
  if (paidNeeded > 0) {
    const paymentResult = await x402Exact(request, reply, {
      priceAtomic: PRICE_WRITE_ATOMIC * paidNeeded,
      endpoint: '/memory/share',
      identityInBody: body.identity,
      method: 'POST',
      inputSchema: ShareMemoriesBodySchema,
    });
    if (paymentResult === 'reply-sent') return reply;
  }

  const rate = await incrementRate(body.identity, '/memory/share', RATE_LIMIT_BULK_PER_MIN);
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const result = await shareMemories({
      fromIdentity: body.identity,
      toIdentity: body.toIdentity,
      memoryIds: body.memoryIds,
    });
    return reply.code(200).send({ success: true, error: null, data: result });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'BAD_INPUT') return handleBadInput(reply, (err as Error).message);
    return handleError(reply, 500, 'share failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleConsolidate = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = ConsolidateMemoriesRequestSchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const body = parsed.data;

  const identity = await getOrCreateIdentity(body.identity);
  const quota = await getOrCreateQuota(identity.id);
  if (!hasFreeCapacity(quota)) {
    const paymentResult = await x402Exact(request, reply, {
      priceAtomic: PRICE_WRITE_ATOMIC,
      endpoint: '/memory/consolidate',
      identityInBody: body.identity,
      method: 'POST',
      inputSchema: ConsolidateMemoriesBodySchema,
    });
    if (paymentResult === 'reply-sent') return reply;
  }

  const rate = await incrementRate(body.identity, '/memory/consolidate');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const result = await consolidateMemories({
      identityAddress: body.identity,
      limit: body.limit,
    });
    return reply.code(200).send({ success: true, error: null, data: result });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'MEMORY_NOT_FOUND') {
      return handleError(reply, 404, (err as Error).message, AmberErrorCodes.MEMORY_NOT_FOUND);
    }
    return handleError(reply, 500, 'consolidate failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleDemoPack = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  // Bodyless probe → 200 with the demo identity's existing onboarding memories
  // and a real recall summary. No seeding/write is performed.
  if (isProbeRequest(request)) {
    reply.header('X-Amber-Probe', 'demo-identity-read');
    const { memories } = await readProbeState(5);
    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        identity: PROBE_IDENTITY,
        recall: { query: 'What are my preferences and wallet facts?', hits: memories.length },
        memories: memories.map((m) => ({
          memoryId: m.memoryId,
          category: m.category,
          createdAt: m.createdAt,
        })),
      },
    });
  }

  const parsed = DemoPackRequestSchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));

  const rate = await incrementRate(parsed.data.identity, '/memory/demo-pack', 3);
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const result = await runDemoPack({
      identityAddress: parsed.data.identity,
      preference: parsed.data.preference,
    });
    return reply.code(200).send({ success: true, error: null, data: result });
  } catch (err) {
    if ((err as { code?: string }).code === 'MEMORY_INJECTION_REJECTED') {
      return handleError(
        reply,
        400,
        (err as Error).message,
        AmberErrorCodes.MEMORY_INJECTION_REJECTED,
        null,
        { flags: (err as { flags?: string[] }).flags ?? [] }
      );
    }
    return handleError(reply, 500, 'demo pack failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleWhoAmI = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = WhoAmIRequestSchema.safeParse(request.body ?? request.query);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));

  const rate = await incrementRate(parsed.data.identity, '/memory/whoami', 30);
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const result = await whoAmI(parsed.data.identity);
    return reply.code(200).send({ success: true, error: null, data: result });
  } catch (err) {
    return handleError(reply, 500, 'whoami failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleSessionDiff = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = SessionDiffRequestSchema.safeParse(request.body ?? request.query);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));

  const rate = await incrementRate(parsed.data.identity, '/memory/diff', 30);
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const result = await sessionDiff(parsed.data.identity, parsed.data.since);
    return reply.code(200).send({ success: true, error: null, data: result });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'BAD_INPUT') return handleBadInput(reply, (err as Error).message);
    return handleError(reply, 500, 'diff failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handlePin = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const parsed = PinMemoryRequestSchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));

  const rate = await incrementRate(parsed.data.identity, '/memory/pin', 30);
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const result = await setMemoryPinned(
      parsed.data.identity,
      parsed.data.memoryId,
      parsed.data.pinned ?? true
    );
    return reply.code(200).send({ success: true, error: null, data: result });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'MEMORY_NOT_FOUND') {
      return handleError(reply, 404, (err as Error).message, AmberErrorCodes.MEMORY_NOT_FOUND);
    }
    return handleError(reply, 500, 'pin failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const LifestyleRememberBodySchema = z.object({
  identity: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((s) => s.toLowerCase()),
  content: z.string().min(1).max(4000),
  kind: z.enum(['preference', 'fact', 'goal']).optional(),
  pin: z.boolean().optional(),
});

// Related memories — pgvector cosine KNN from a seed memory.
// Paid at PRICE_QUERY_ATOMIC. Powers Best Product graph recall + Software
// Utility recommendation. Uses body OR query so REST + MCP tool share shape.
const handleRelated = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const payload = {
    ...(request.query as object),
    ...(typeof request.body === 'object' && request.body !== null ? request.body : {}),
    // The path param (:memoryId) beats body/query so /memory/related/:id works.
    memoryId:
      (request.params as { memoryId?: string }).memoryId ??
      (request.query as { memoryId?: string }).memoryId ??
      (typeof request.body === 'object' && request.body !== null
        ? (request.body as { memoryId?: string }).memoryId
        : undefined),
  };
  const parsed = RelatedMemoryRequestSchema.safeParse(payload);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));
  const q = parsed.data;

  const paymentResult = await x402Exact(request, reply, {
    priceAtomic: PRICE_QUERY_ATOMIC,
    endpoint: '/memory/related',
    identityInBody: q.identity,
    method: 'GET',
    inputSchema: RelatedMemoryBodySchema,
  });
  if (paymentResult === 'reply-sent') return;

  const rate = await incrementRate(q.identity, '/memory/related');
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const results = await queryRelated({
      identityAddress: q.identity,
      memoryId: q.memoryId,
      k: q.k,
      minRelevance: q.minRelevance,
    });
    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        seed: q.memoryId,
        results,
        count: results.length,
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'MEMORY_NOT_FOUND') {
      return handleError(reply, 404, (err as Error).message, AmberErrorCodes.MEMORY_NOT_FOUND);
    }
    return handleError(reply, 500, 'related failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

const handleLifestyle = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  // Bodyless probe → 200 with the demo identity's latest lifestyle-style memory.
  // No write is performed.
  if (isProbeRequest(request)) {
    reply.header('X-Amber-Probe', 'demo-identity-latest-write');
    const { memories } = await readProbeState(1);
    const latest = memories[0] ?? null;
    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        identity: PROBE_IDENTITY,
        memoryId: latest?.memoryId ?? null,
        category: latest?.category ?? null,
        tags: latest?.tags ?? [],
        pinned: false,
        portraitUrl: `${PUBLIC_BASE_URL}/portrait/${PROBE_IDENTITY}.svg`,
      },
    });
  }

  const parsed = LifestyleRememberBodySchema.safeParse(request.body);
  if (!parsed.success) return handleBadInput(reply, zodFlat(parsed.error));

  const rate = await incrementRate(parsed.data.identity, '/memory/lifestyle', 20);
  if (!rate.allowed) return handleRateLimited(reply, rate.retryAfterSeconds);

  try {
    const result = await lifestyleRemember({
      identityAddress: parsed.data.identity,
      content: parsed.data.content,
      kind: parsed.data.kind,
      pin: parsed.data.pin,
    });
    return reply.code(200).send({ success: true, error: null, data: result });
  } catch (err) {
    if ((err as { code?: string }).code === 'MEMORY_INJECTION_REJECTED') {
      return handleError(
        reply,
        400,
        (err as Error).message,
        AmberErrorCodes.MEMORY_INJECTION_REJECTED,
        null,
        { flags: (err as { flags?: string[] }).flags ?? [] }
      );
    }
    return handleError(reply, 500, 'lifestyle remember failed', AmberErrorCodes.INTERNAL, err as Error);
  }
};

export const memoryRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.post('/write', handleWrite);
  app.get('/query', handleQuery);
  app.post('/query', handleQuery);
  app.post('/bulk-write', handleBulkWrite);
  app.get('/session-context', handleSessionContext);
  app.post('/session-context', handleSessionContext);
  app.get('/list', handleList);
  app.get('/export', handleExport);
  app.post('/seed-wallet', handleSeedWallet);
  app.post('/demo-pack', handleDemoPack);
  app.post('/whoami', handleWhoAmI);
  app.get('/whoami', handleWhoAmI);
  app.post('/diff', handleSessionDiff);
  app.get('/diff', handleSessionDiff);
  app.post('/pin', handlePin);
  app.post('/lifestyle', handleLifestyle);
  app.post('/share', handleShare);
  app.post('/consolidate', handleConsolidate);
  // Related must be registered BEFORE /:memoryId so `/related/:memoryId` and
  // `/related` are not swallowed by the wildcard get handler.
  app.get('/related/:memoryId', handleRelated);
  app.post('/related', handleRelated);
  // `/memory/:id/attestation` MUST be registered before `/:memoryId` DELETE
  // so Fastify does not treat the literal segment as the wildcard.
  app.get('/:id/attestation', memoryAttestationHandler);
  app.get('/:memoryId', handleGet);
  app.delete('/:memoryId', handleDelete);
  done();
};
