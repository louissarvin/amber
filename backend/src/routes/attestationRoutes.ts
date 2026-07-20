import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { z } from 'zod';
import { prismaQuery } from '../lib/prisma.ts';
import { getMemoryAttestationView } from '../services/attestationLookup.ts';
import { AmberErrorCodes, handleBadInput, handleError } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// Public attestation read endpoints (free, unauthenticated).
//
// Attestations are public by design — they're on-chain Merkle roots. Exposing
// them via a stable HTTP surface lets marketplace judges + verifiers audit our
// batch proofs without holding a paid session.
// -----------------------------------------------------------------------------

const bytesToHex = (b: Uint8Array | Buffer): string => {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return `0x${buf.toString('hex')}`;
};

const RootHexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, { message: 'root must be 0x + 64 hex chars' });

const MemoryIdSchema = z.string().min(1).max(64);

const handleGetByRoot = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { root } = request.params as { root?: string };
  const parsed = RootHexSchema.safeParse(root);
  if (!parsed.success) return handleBadInput(reply, 'invalid Merkle root');

  const rootBuf = Buffer.from(parsed.data.replace(/^0x/, ''), 'hex');

  try {
    const attestation = await prismaQuery.attestation.findFirst({
      where: { merkleRoot: rootBuf },
      include: {
        identity: { select: { address: true } },
        leaves: {
          orderBy: { position: 'asc' },
          select: { position: true, memoryId: true },
        },
      },
    });

    if (!attestation) {
      return handleError(
        reply,
        404,
        'attestation root not found',
        AmberErrorCodes.MEMORY_NOT_FOUND
      );
    }

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        root: bytesToHex(attestation.merkleRoot),
        chainId: attestation.chainId,
        status: attestation.status,
        txHash: attestation.txHash,
        signerAddress: attestation.signerAddress,
        identity: attestation.identity.address,
        attestedAt: attestation.attestedAt?.toISOString() ?? null,
        submittedAt: attestation.submittedAt?.toISOString() ?? null,
        leafCount: attestation.leaves.length,
        leaves: attestation.leaves.map((l) => ({
          position: l.position,
          memoryId: l.memoryId,
        })),
      },
    });
  } catch (err) {
    return handleError(
      reply,
      500,
      'attestation lookup failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

const handleGetMemoryAttestation = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | void> => {
  const { id } = request.params as { id?: string };
  const parsed = MemoryIdSchema.safeParse(id);
  if (!parsed.success) return handleBadInput(reply, 'invalid memoryId');

  try {
    const view = await getMemoryAttestationView(parsed.data);
    if (!view) {
      return handleError(reply, 404, 'memory not found', AmberErrorCodes.MEMORY_NOT_FOUND);
    }
    return reply.code(200).send({
      success: true,
      error: null,
      data: view,
    });
  } catch (err) {
    return handleError(
      reply,
      500,
      'memory attestation lookup failed',
      AmberErrorCodes.INTERNAL,
      err as Error
    );
  }
};

export const attestationRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done
) => {
  // Registered at prefix `/attestation`
  app.get('/:root', handleGetByRoot);
  done();
};

// Registered under /memory prefix via memoryRoutes plugin
export const memoryAttestationHandler = handleGetMemoryAttestation;
