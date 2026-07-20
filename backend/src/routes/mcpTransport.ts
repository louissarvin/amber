import crypto from 'node:crypto';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { originAllowlistMiddleware } from '../middlewares/originAllowlist.ts';
import { x402Exact } from '../middlewares/x402Middleware.ts';
import { createSession, touchSession } from '../lib/mcpSessionStore.ts';
import { writeOne, writeBulk } from '../services/memoryWriter.ts';
import {
  TEMPLATE_VERTICALS,
  TEMPLATE_VERTICAL_KEYS,
  writeVerticalMemory,
} from '../services/memoryTemplate.ts';
import { queryTopK, queryRelated } from '../services/memoryQuery.ts';
import { computeReputationScore, ReputationNotFoundError } from '../services/reputationScore.ts';
import { fetchSessionContext } from '../services/sessionContext.ts';
import { listMemories, softDeleteMemory, getMemoryById } from '../services/memoryLifecycle.ts';
import { attestationRefFromMemoryId, pendingAttestationRef } from '../services/attestationRef.ts';
import { getOrCreateIdentity } from '../services/identity.ts';
import { getOrCreateQuota, hasFreeCapacity } from '../lib/quota/service.ts';
import { incrementRate } from '../services/rateLimit.ts';
import {
  BulkWriteRequestSchema,
  BulkWriteBodySchema,
  ConsolidateMemoriesBodySchema,
  ConsolidateMemoriesRequestSchema,
  DeleteMemoryRequestSchema,
  DeleteMemoryBodySchema,
  ListMemoriesRequestSchema,
  ListMemoriesQuerySchema,
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
  DemoPackBodySchema,
  WhoAmIRequestSchema,
  WhoAmIBodySchema,
  SessionDiffRequestSchema,
  SessionDiffBodySchema,
  PinMemoryRequestSchema,
  PinMemoryBodySchema,
  PortabilityPackRequestSchema,
  PortabilityPackBodySchema,
} from '../schemas/memory.ts';
import {
  GenerateSealBodySchema,
  GenerateSealRequestSchema,
  VerifyAttestationBodySchema,
  VerifyAttestationRequestSchema,
  WalletSeedBodySchema,
  WalletSeedRequestSchema,
} from '../schemas/seal.ts';
import { generateSeal } from '../services/sealGenerator.ts';
import { seedWalletMemories } from '../services/walletSeed.ts';
import { getOkxWalletPortfolio } from '../lib/okx/dexPrices.ts';
import { getMemoryAttestationView } from '../services/attestationLookup.ts';
import { shareMemories, consolidateMemories } from '../services/memoryShare.ts';
import {
  buildOnboardingManifest,
  getIdentityStatsSafe,
  runDemoPack,
} from '../services/onboarding.ts';
import { buildAnalytics } from './analyticsRoutes.ts';
import { buildGraph } from './graphRoutes.ts';
import { whoAmI, sessionDiff, setMemoryPinned } from '../services/memoryWhoami.ts';
import { buildPortabilityPack } from '../services/memoryPortability.ts';
import { buildJudgingPack } from '../services/judgingPack.ts';
import { buildFinanceBrief } from '../services/financeBrief.ts';
import { lifestyleRemember } from '../services/lifestyleRemember.ts';
import { getOrGeneratePortrait } from '../services/portraitService.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { collectAmberStats } from '../services/metrics.ts';
import {
  FREE_TIER_WRITES_PER_IDENTITY,
  MCP_PROTOCOL_VERSION,
  PRICE_QUERY_ATOMIC,
  PRICE_SEAL_ATOMIC,
  PRICE_SESSION_CONTEXT_ATOMIC,
  PRICE_WRITE_ATOMIC,
  PUBLIC_BASE_URL,
  RATE_LIMIT_BULK_PER_MIN,
  XLAYER_CHAIN_ID,
  USDT_XLAYER_ADDRESS,
} from '../config/main-config.ts';
import { AmberErrorCodes, handleError } from '../utils/errorHandler.ts';

// -----------------------------------------------------------------------------
// MCP Streamable HTTP transport at /mcp (spec version 2025-06-18)
// -----------------------------------------------------------------------------

const JsonRpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.any().optional(),
});

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

const rpcOk = <T>(id: string | number | null | undefined, result: T): {
  jsonrpc: '2.0';
  id: string | number | null;
  result: T;
} => ({ jsonrpc: '2.0', id: id ?? null, result });

const rpcErr = (
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown
): {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
} => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, data } });

const checkAccept = (req: FastifyRequest): boolean => {
  const raw = req.headers.accept;
  const accept = Array.isArray(raw) ? raw.join(',') : raw ?? '';
  return accept.includes('application/json') && accept.includes('text/event-stream');
};

const echoProtocolVersion = (reply: FastifyReply, req: FastifyRequest): void => {
  const raw = req.headers['mcp-protocol-version'];
  const version = Array.isArray(raw) ? raw[0] : raw ?? MCP_PROTOCOL_VERSION;
  reply.header('MCP-Protocol-Version', version);
};

const tools = [
  {
    name: 'memory_write',
    description:
      'Persist a memory owned by an ERC-8004 identity. Returns memoryId and an XLayer attestation reference. Paid via x402 exact scheme (0.001 USDT per call). First 100 writes per identity are free.',
    inputSchema: WriteMemoryBodySchema,
    outputSchema: {
      type: 'object',
      required: ['memoryId', 'createdAt', 'attestation', 'quota'],
      properties: {
        memoryId: { type: 'string', description: 'UUID of the created memory' },
        createdAt: { type: 'string', format: 'date-time' },
        attestation: { type: 'object', description: 'X Layer Merkle attestation reference' },
        quota: {
          type: 'object',
          properties: { freeRemaining: { type: 'integer' } },
        },
        replay: { type: 'boolean' },
      },
    },
  },
  {
    name: 'memory_query',
    description:
      "Semantic search over an identity's memory namespace. Paid 0.0005 USDT per query via x402 exact scheme.",
    inputSchema: QueryMemoryQuerySchema,
    outputSchema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              memoryId: { type: 'string' },
              content: { type: 'string' },
              category: { type: 'string' },
              relevance: { type: 'number' },
              createdAt: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'memory_bulk_write',
    description:
      'Bulk memory writes (up to 50). Items within the free-tier allowance are free; over-cap items are paid at 0.001 USDT each via x402 exact.',
    inputSchema: BulkWriteBodySchema,
    outputSchema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              memoryId: { type: 'string' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  index: { type: 'integer' },
                },
              },
            },
          },
        },
        attestation: { type: 'object', description: 'Pending X Layer attestation reference' },
        paidItems: { type: 'integer' },
        freeItems: { type: 'integer' },
      },
    },
  },
  {
    name: 'memory_session_context',
    description:
      'Fetch the last N memories to bootstrap a new agent session. Paid 0.0002 USDT.',
    inputSchema: SessionContextQuerySchema,
    outputSchema: {
      type: 'object',
      required: ['memories', 'totalMemories'],
      properties: {
        safetyFrame: { type: 'string', description: 'Untrusted-memory safety framing note' },
        memories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              memoryId: { type: 'string' },
              content: { type: 'string' },
              category: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              createdAt: { type: 'string' },
              relevance: { type: 'number' },
              attestation: { type: 'object' },
            },
          },
        },
        totalMemories: { type: 'integer' },
      },
    },
  },
  {
    name: 'memory_list',
    description:
      'List recent memories for an identity (chronological, paginated). Free. Use memory_query for semantic search.',
    inputSchema: ListMemoriesQuerySchema,
    outputSchema: {
      type: 'object',
      required: ['memories', 'total'],
      properties: {
        memories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              memoryId: { type: 'string' },
              content: { type: 'string' },
              category: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              createdAt: { type: 'string' },
            },
          },
        },
        total: { type: 'integer' },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  },
  {
    name: 'memory_delete',
    description:
      'Soft-delete a memory owned by the given identity. Free. Ownership is enforced.',
    inputSchema: DeleteMemoryBodySchema,
    outputSchema: {
      type: 'object',
      required: ['memoryId', 'deletedAt'],
      properties: {
        memoryId: { type: 'string' },
        deletedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
  {
    name: 'memory_get',
    description:
      'Retrieve a single memory by its ID. Ownership enforced — identity must match. Paid 0.0005 USDT via x402 exact.',
    inputSchema: {
      type: 'object',
      required: ['identity', 'memoryId'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address' },
        memoryId: { type: 'string', description: 'The memory ID to retrieve' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['memoryId', 'content', 'category'],
      properties: {
        memoryId: { type: 'string' },
        content: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { description: 'Arbitrary per-memory metadata' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        attestation: { type: 'object', description: 'X Layer attestation reference' },
      },
    },
  },
  {
    name: 'memory_seed_wallet',
    description:
      'Bootstrap memories from public X Layer wallet state (balance, tx count, recent activity). Free. Rate limited. Makes recall demos non-empty.',
    inputSchema: WalletSeedBodySchema,
    outputSchema: {
      type: 'object',
      required: ['memoriesWritten', 'memoryIds'],
      properties: {
        memoriesWritten: { type: 'integer' },
        memoryIds: { type: 'array', items: { type: 'string' } },
        snapshot: {
          type: 'object',
          properties: {
            balanceOkb: { type: 'string' },
            txCount: { type: 'integer' },
            isContract: { type: 'boolean' },
            recentTxsFound: { type: 'integer' },
            lookbackBlocks: { type: 'integer' },
          },
        },
      },
    },
  },
  {
    name: 'memory_verify_attestation',
    description:
      'Fetch the X Layer Merkle attestation status and inclusion proof for a memoryId. Free.',
    inputSchema: VerifyAttestationBodySchema,
    outputSchema: {
      type: 'object',
      required: ['memoryId', 'identity', 'attestation'],
      properties: {
        memoryId: { type: 'string' },
        identity: { type: 'string' },
        attestation: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            chainId: { type: 'integer' },
            txHash: { type: 'string', nullable: true },
            root: { type: 'string', nullable: true },
            attestedAt: { type: 'string', nullable: true },
            leafIndex: { type: 'integer', nullable: true },
            leaf: { type: 'string', nullable: true },
            proof: { type: 'array', items: { type: 'string' }, nullable: true },
            explorerHint: { type: 'string', nullable: true },
            onChainLive: { type: 'boolean' },
            settlementNote: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'seal_generate',
    description:
      'SEALSCRIBE-lite: generate a wax-seal decree SVG keepsake for a subject and decree text, tied to an ERC-8004 identity. Paid 0.05 USDT via x402 exact.',
    inputSchema: GenerateSealBodySchema,
    outputSchema: {
      type: 'object',
      required: ['sealId', 'svgUrl'],
      properties: {
        sealId: { type: 'string' },
        subject: { type: 'string' },
        sigilStyle: { type: 'string' },
        svgUrl: { type: 'string' },
        svgPath: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  },
  {
    name: 'portrait_get',
    description:
      'Fetch the memory constellation portrait URL for an ERC-8004 identity. Returns a publicly accessible SVG URL showing all memories as a star-chart artwork. Free.',
    inputSchema: {
      type: 'object',
      required: ['identity'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['svgUrl', 'identity'],
      properties: {
        svgUrl: { type: 'string' },
        metaUrl: { type: 'string' },
        identity: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
  {
    name: 'memory_share',
    description:
      'Copy selected memories from your ERC-8004 identity to another identity for portable shared context. Paid per over-cap destination write at 0.001 USDT.',
    inputSchema: ShareMemoriesBodySchema,
    outputSchema: {
      type: 'object',
      required: ['shared', 'memoryIds'],
      properties: {
        shared: { type: 'integer', description: 'Number of memories copied to the destination identity' },
        memoryIds: { type: 'array', items: { type: 'string' } },
        skipped: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'memory_consolidate',
    description:
      'Build a deterministic dossier system-memory from your most recent entries (no LLM). Useful session bootstrap. Paid 0.001 USDT after free tier.',
    inputSchema: ConsolidateMemoriesBodySchema,
    outputSchema: {
      type: 'object',
      required: ['memoryId'],
      properties: {
        memoryId: { type: 'string' },
        sourceCount: { type: 'integer' },
        content: { type: 'string' },
        freeRemaining: { type: 'integer' },
      },
    },
  },
  {
    name: 'memory_demo_pack',
    description:
      'One-call judge bootstrap: seed wallet facts, write a preference, consolidate dossier, sample recall, portrait URL. Free. Rate limited.',
    inputSchema: DemoPackBodySchema,
    outputSchema: {
      type: 'object',
      required: ['identity', 'steps'],
      properties: {
        identity: { type: 'string' },
        steps: { type: 'array', items: { type: 'string' } },
        seed: { type: 'object', description: 'Wallet seed result' },
        preferenceMemoryId: { type: 'string', nullable: true },
        dossier: { type: 'object', nullable: true },
        recall: {
          type: 'object',
          properties: { query: { type: 'string' }, hits: { type: 'integer' } },
        },
        portraitUrl: { type: 'string' },
        sealHint: { type: 'string' },
        onChainAttestation: { type: 'object' },
        onchainOS: {
          type: 'object',
          properties: {
            mcpEndpoint: { type: 'string' },
            naturalLanguagePrompt: { type: 'string' },
            x402CheckCommand: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'identity_stats',
    description:
      'Public stats for an ERC-8004 identity on AMBER (memory count, attested count, free writes used). Free.',
    inputSchema: {
      type: 'object',
      required: ['identity'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address' },
      },
    },
    outputSchema: {
      // Returns full stats for a registered identity, or { address, registered: false }
      // for an identity that has never written. Only `address` is always present.
      type: 'object',
      required: ['address'],
      properties: {
        address: { type: 'string' },
        registered: { type: 'boolean' },
        erc8004AgentId: { type: 'string', nullable: true },
        memoryCount: { type: 'integer' },
        attestedCount: { type: 'integer' },
        attestationRate: { type: 'string' },
        sealCount: { type: 'integer' },
        freeWrites: { type: 'integer' },
        paidWrites: { type: 'string' },
        firstSeenAt: { type: 'string', nullable: true },
        lastActiveAt: { type: 'string', nullable: true },
        links: {
          type: 'object',
          properties: {
            portrait: { type: 'string' },
            analytics: { type: 'string' },
            graph: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'amber_onboarding',
    description:
      'Returns the Onchain OS onboarding manifest: MCP prompts, x402-check command, prize tracks, attestation capability. Free. No identity required.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      // Deterministic onboarding manifest. Only stable top-level fields are
      // described; the manifest may grow additional descriptive fields.
      type: 'object',
      required: ['name', 'version'],
      properties: {
        name: { type: 'string' },
        version: { type: 'string' },
        category: { type: 'string' },
        tracks: { type: 'array', items: { type: 'string' } },
        positioning: { type: 'string' },
        chain: { type: 'object' },
        payment: { type: 'object' },
        endpoints: { type: 'object' },
        mcpTools: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'portfolio_snapshot',
    description:
      'Fetch real-time portfolio value and token balances for an ERC-8004 identity from OKX DEX API, and store as a memory. Free.',
    inputSchema: {
      type: 'object',
      required: ['identity'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['identity', 'totalUsdValue', 'tokens'],
      properties: {
        identity: { type: 'string' },
        totalUsdValue: { type: 'string' },
        tokens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              balance: { type: 'string' },
              usdValue: { type: 'string' },
            },
          },
        },
        memoryId: { type: 'string', nullable: true },
        portfolioUrl: { type: 'string' },
        fetchedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
  {
    name: 'memory_analytics',
    description:
      'Get detailed analytics for an ERC-8004 identity: category breakdown, daily timeline, top tags, attestation stats, and seal count. Free.',
    inputSchema: {
      type: 'object',
      required: ['identity'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['address', 'totalMemories'],
      properties: {
        address: { type: 'string' },
        totalMemories: { type: 'integer' },
        categoryBreakdown: {
          type: 'array',
          items: {
            type: 'object',
            properties: { category: { type: 'string' }, count: { type: 'integer' } },
          },
        },
        dailyTimeline: {
          type: 'array',
          items: {
            type: 'object',
            properties: { day: { type: 'string' }, count: { type: 'integer' } },
          },
        },
        topTags: {
          type: 'array',
          items: {
            type: 'object',
            properties: { tag: { type: 'string' }, count: { type: 'integer' } },
          },
        },
        attestedCount: { type: 'integer' },
        pendingAttestation: { type: 'integer' },
        sealCount: { type: 'integer' },
        sharedIn: { type: 'integer' },
        sharedOut: { type: 'integer' },
        portraitUrl: { type: 'string' },
        analyticsUrl: { type: 'string' },
        generatedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
  {
    name: 'memory_graph',
    description:
      'Get the memory graph for an ERC-8004 identity: nodes (memories) and edges (shared tags). Use for visualizing memory relationships. Free.',
    inputSchema: {
      type: 'object',
      required: ['identity'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['address', 'nodes', 'edges'],
      properties: {
        address: { type: 'string' },
        nodes: { type: 'array', items: { type: 'object' } },
        edges: { type: 'array', items: { type: 'object' } },
        metadata: {
          type: 'object',
          properties: {
            totalNodes: { type: 'integer' },
            totalEdges: { type: 'integer' },
          },
        },
        graphUrl: { type: 'string' },
      },
    },
  },
  {
    name: 'memory_whoami',
    description:
      'Answer "who am I?" for an ERC-8004 identity — preferences, facts, pinned memories, dossier snapshot, portrait URL. Free. The 3-second demo hook.',
    inputSchema: WhoAmIBodySchema,
    outputSchema: {
      type: 'object',
      required: ['identity', 'summary'],
      properties: {
        identity: { type: 'string' },
        summary: { type: 'string' },
        preferences: { type: 'array', items: { type: 'object' } },
        facts: { type: 'array', items: { type: 'object' } },
        pinned: { type: 'array', items: { type: 'object' } },
        dossier: {
          type: 'object',
          nullable: true,
          properties: {
            memoryId: { type: 'string', nullable: true },
            content: { type: 'string' },
            sourceCount: { type: 'integer' },
          },
        },
        stats: {
          type: 'object',
          properties: {
            totalActive: { type: 'integer' },
            preferenceCount: { type: 'integer' },
            factCount: { type: 'integer' },
            pinnedCount: { type: 'integer' },
          },
        },
        portraitUrl: { type: 'string' },
        nextPrompts: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'memory_diff',
    description:
      'List memories written after a timestamp so a new agent session can see what changed. Free.',
    inputSchema: SessionDiffBodySchema,
    outputSchema: {
      type: 'object',
      required: ['identity', 'since', 'added', 'count'],
      properties: {
        identity: { type: 'string' },
        since: { type: 'string' },
        added: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              memoryId: { type: 'string' },
              content: { type: 'string' },
              category: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              createdAt: { type: 'string' },
            },
          },
        },
        count: { type: 'integer' },
        note: { type: 'string' },
      },
    },
  },
  {
    name: 'memory_pin',
    description:
      'Pin or unpin a memory so whoami and session context prioritize durable facts. Free.',
    inputSchema: PinMemoryBodySchema,
    outputSchema: {
      type: 'object',
      required: ['memoryId', 'pinned'],
      properties: {
        memoryId: { type: 'string' },
        pinned: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'memory_portability_pack',
    description:
      'Return a bounded AMBER portability pack (JSON, sha256, attestation refs) for migrating memories across MCP clients or backing up an ERC-8004 identity. Free.',
    inputSchema: PortabilityPackBodySchema,
    outputSchema: {
      type: 'object',
      required: ['schema', 'identity', 'memories', 'sha256'],
      properties: {
        schema: { type: 'string', description: 'Pack schema version, e.g. amber.portability.v1' },
        identity: { type: 'string' },
        generatedAt: { type: 'string', format: 'date-time' },
        safetyFrame: { type: 'string' },
        count: { type: 'integer' },
        limit: { type: 'integer' },
        since: { type: 'string', nullable: true },
        memories: { type: 'array', items: { type: 'object' } },
        sha256: { type: 'string' },
        importHint: {
          type: 'object',
          properties: {
            mcpTool: { type: 'string' },
            endpoint: { type: 'string' },
            note: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'amber_judging_pack',
    description:
      'Return the Build X / OKX.AI judging evidence packet: official criteria, AMBER prize strategy, live stats, 90-second demo steps, and submission checklist. Free. No identity required.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      // Deterministic evidence packet. Only stable top-level fields are
      // described; the packet carries additional descriptive sub-objects.
      type: 'object',
      required: ['schema'],
      properties: {
        schema: { type: 'string', description: 'Packet schema version, e.g. amber.buildx_judging_pack.v1' },
        product: { type: 'object' },
        hackathon: { type: 'object' },
        prizeStrategy: { type: 'array', items: { type: 'object' } },
        liveEvidence: { type: 'object' },
      },
    },
  },
  {
    name: 'finance_brief',
    description:
      'Finance Copilot: seeds X Layer wallet history, stores a live OKX portfolio snapshot fact, computes the PnL delta versus the last snapshot (with top movers), and returns semantic recall of financial context. One-call financial briefing. Free.',
    inputSchema: {
      type: 'object',
      required: ['identity'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['identity', 'portfolio', 'pnl'],
      properties: {
        identity: { type: 'string' },
        financialSeedSummary: { type: 'string' },
        portfolio: {
          type: 'object',
          properties: {
            totalUsdValue: { type: 'string' },
            topTokens: { type: 'array', items: { type: 'object' } },
            memoryId: { type: 'string', nullable: true },
            portfolioUrl: { type: 'string' },
            fetchedAt: { type: 'string', format: 'date-time' },
          },
        },
        pnl: {
          type: 'object',
          properties: {
            previousUsdValue: { type: 'string', nullable: true },
            deltaUsdValue: { type: 'string' },
            deltaPercent: { type: 'string' },
            direction: { type: 'string', enum: ['up', 'down', 'flat', 'first-snapshot'] },
            since: { type: 'string', nullable: true },
            deltaMemoryId: { type: 'string', nullable: true },
            topMovers: { type: 'array', items: { type: 'object' } },
          },
        },
        recalledMemories: { type: 'integer' },
        topFinancialContext: { type: 'array', items: { type: 'object' } },
        portfolioHighlight: { type: 'string', nullable: true },
        nextPrompts: { type: 'array', items: { type: 'string' } },
        portraitUrl: { type: 'string' },
      },
    },
  },
  {
    name: 'lifestyle_remember',
    description:
      'Lifestyle Companion: store a personal preference/fact/goal under your ERC-8004 identity, pin it, and return memory_whoami context so every agent session knows you. Free.',
    inputSchema: {
      type: 'object',
      required: ['identity', 'content'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address' },
        content: {
          type: 'string',
          minLength: 1,
          maxLength: 4000,
          description: 'Lifestyle preference, fact, or goal to remember',
        },
        kind: {
          type: 'string',
          enum: ['preference', 'fact', 'goal'],
          description: 'Stored as preference or fact (goals map to fact + goal tag)',
        },
        pin: {
          type: 'boolean',
          description: 'Pin this memory (default true)',
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['identity', 'memoryId'],
      properties: {
        identity: { type: 'string' },
        memoryId: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        pinned: { type: 'boolean' },
        whoami: { type: 'object', description: 'memory_whoami context snapshot' },
        portraitUrl: { type: 'string' },
        nextPrompts: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  // ── NEW tools added for hackathon maximization ─────────────────────────────
  {
    name: 'amber_live_stats',
    description:
      'Live revenue and usage stats for AMBER. Revenue Rocket evidence: total identities, memories, payments, and USDT volume. Free. Judges: call this to see real on-chain payment activity.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      required: ['last24h', 'allTime', 'generatedAt'],
      properties: {
        last24h: {
          type: 'object',
          properties: {
            memoriesWritten: { type: 'integer' },
            activeIdentities: { type: 'integer' },
            paymentsCount: { type: 'integer' },
            usdtVolume: { type: 'string' },
          },
        },
        allTime: {
          type: 'object',
          properties: {
            totalIdentities: { type: 'integer' },
            totalMemories: { type: 'integer' },
            totalPaymentsCount: { type: 'integer' },
            totalUsdtVolume: { type: 'string' },
          },
        },
        topCategories: { type: 'array' },
        network: { type: 'string' },
        protocol: { type: 'string' },
        generatedAt: { type: 'string' },
      },
    },
  },
  {
    name: 'daily_brief',
    description:
      'Daily digest of what an ERC-8004 identity remembered in the last N hours (default 24). Start every agent session with fresh context from yesterday. Free.',
    inputSchema: {
      type: 'object',
      required: ['identity'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address' },
        lookbackHours: {
          type: 'integer',
          minimum: 1,
          maximum: 72,
          description: 'Hours to look back (default 24)',
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['identity', 'newMemoriesCount', 'since'],
      properties: {
        identity: { type: 'string' },
        lookbackHours: { type: 'integer' },
        since: { type: 'string', format: 'date-time' },
        newMemoriesCount: { type: 'integer' },
        categoryBreakdown: { type: 'array' },
        recentMemories: { type: 'array' },
        nextPrompts: { type: 'array', items: { type: 'string' } },
        portraitUrl: { type: 'string' },
        generatedAt: { type: 'string' },
      },
    },
  },
  {
    name: 'memory_goal_set',
    description:
      'Lifestyle Companion: set or update a goal in AMBER memory, pin it, and get full whoami context. Goals persist across all agent sessions. Free (up to free tier).',
    inputSchema: {
      type: 'object',
      required: ['identity', 'goal'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address' },
        goal: { type: 'string', minLength: 1, maxLength: 1000, description: 'The goal to persist' },
        deadline: { type: 'string', description: 'Optional deadline (e.g. "2026-12-31")' },
        priority: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Goal priority (default medium)',
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['identity', 'memoryId', 'goal'],
      properties: {
        identity: { type: 'string' },
        memoryId: { type: 'string' },
        goal: { type: 'string' },
        deadline: { type: 'string', nullable: true },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        pinned: { type: 'boolean' },
        freeRemaining: { type: 'integer' },
        replay: { type: 'boolean' },
        whoami: { type: 'object', description: 'memory_whoami context snapshot' },
        portraitUrl: { type: 'string' },
        nextPrompts: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'memory_related',
    description:
      "Find memories semantically related to a seed memory using pgvector cosine KNN. Answers 'what else do I know about this?' Paid 0.0005 USDT via x402 exact scheme.",
    inputSchema: RelatedMemoryBodySchema,
    outputSchema: {
      type: 'object',
      required: ['seed', 'results', 'count'],
      properties: {
        seed: { type: 'string', description: 'Source memoryId used for the KNN search' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              memoryId: { type: 'string' },
              content: { type: 'string' },
              category: { type: 'string' },
              relevance: { type: 'number' },
              createdAt: { type: 'string' },
            },
          },
        },
        count: { type: 'integer' },
      },
    },
  },
  {
    name: 'memory_habit_check',
    description:
      "Lifestyle Companion: track a daily habit checkin, compute streak (consecutive days), pin the habit fact, and return whoami context. Habits persist across all agent sessions and clients. Free up to free tier, then 0.001 USDT via x402.",
    inputSchema: {
      type: 'object',
      required: ['identity', 'habit'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address' },
        habit: { type: 'string', minLength: 1, maxLength: 200, description: 'The habit name (e.g. "morning run", "read 30 min")' },
        note: { type: 'string', maxLength: 500, description: 'Optional checkin note (e.g. "5km, felt great")' },
        skipToday: { type: 'boolean', description: 'Mark today as skipped instead of a checkin (streak resets)' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['identity', 'habit', 'streakCount'],
      properties: {
        identity: { type: 'string' },
        habit: { type: 'string' },
        memoryId: { type: 'string' },
        streakCount: { type: 'integer', description: 'Consecutive days including today' },
        lastCheckinDate: { type: 'string' },
        totalCheckins: { type: 'integer' },
        skipped: { type: 'boolean' },
        streakBreakdown: {
          type: 'object',
          properties: {
            longestStreak: { type: 'integer' },
            firstCheckin: { type: 'string' },
          },
        },
        nextPrompts: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'memory_template',
    description:
      "OKX AI vertical-aware memory writer. Persists context for the 5 OKX AI ASP categories: 'professional_asset' (decks, reports, spreadsheets), 'resume' (career history, ATS keywords), 'creative' (brand palette, design refs, NFT lineage), 'software' (schemas, deploy configs, codebase notes), 'prediction' (market conviction, PnL history). Auto-tags for the vertical so downstream ASPs can discover context in one query. Free up to free tier, then 0.001 USDT via x402.",
    inputSchema: {
      type: 'object',
      required: ['identity', 'vertical', 'content'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address' },
        vertical: {
          type: 'string',
          enum: ['professional_asset', 'resume', 'creative', 'software', 'prediction'],
          description: 'Which OKX AI ASP category this memory serves',
        },
        content: { type: 'string', minLength: 1, maxLength: 8192, description: 'The context to persist' },
        subject: { type: 'string', maxLength: 200, description: 'Optional subject line (e.g. "Q3 board deck", "Senior SWE resume")' },
        pin: { type: 'boolean', description: 'Pin the memory so it surfaces in every whoami call' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['identity', 'memoryId', 'vertical', 'tags'],
      properties: {
        identity: { type: 'string' },
        memoryId: { type: 'string' },
        vertical: { type: 'string' },
        subject: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        pinned: { type: 'boolean' },
        freeRemaining: { type: 'integer' },
        crossVerticalRecall: { type: 'string', description: 'Suggested query for other ASPs to discover this memory' },
      },
    },
  },
  {
    name: 'memory_reputation_lookup',
    description:
      "Query the AMBER Reputation Score (0-100) for any ERC-8004 identity. Deterministic score computed from persistence + verification + economic + breadth + deliberateness + longevity. Free. Any ASP on OKX AI can gate access, weight votes, or filter counterparties by this score. Directly implements OKX AI's 'persistent identity that accumulates reputation across all work' thesis.",
    inputSchema: {
      type: 'object',
      required: ['identity'],
      properties: {
        identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'ERC-8004 identity address to look up' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['address', 'score', 'tier'],
      properties: {
        address: { type: 'string' },
        score: { type: 'integer', minimum: 0, maximum: 100 },
        tier: { type: 'string', enum: ['unseen', 'fresh', 'active', 'established', 'trusted'] },
        tierIcon: { type: 'string' },
        summary: { type: 'string' },
        totalMemories: { type: 'integer' },
        attestationRate: { type: 'string' },
        breakdown: {
          type: 'object',
          description: '6-axis score breakdown: persistence, verification, economic, breadth, deliberateness, longevity',
        },
      },
    },
  },
];

const KNOWN_TOOLS = new Set(tools.map((t) => t.name));

// Single source of truth for the number of MCP tools AMBER exposes. Derived
// from the tools array so judge-facing counts can never drift into a false
// claim. Consumed by judgingPack.ts and healthRoutes.ts.
export const MCP_TOOL_COUNT = tools.length;

const handleInitialize = async (
  req: FastifyRequest,
  reply: FastifyReply,
  body: JsonRpcRequest
): Promise<FastifyReply> => {
  const params = (body.params ?? {}) as {
    protocolVersion?: string;
    clientInfo?: { name?: string; version?: string };
  };
  const protocolVersion = params.protocolVersion ?? MCP_PROTOCOL_VERSION;

  const sessionId = crypto.randomUUID();
  const origin = req.headers.origin;
  const originStr = Array.isArray(origin) ? origin[0] : origin ?? '';

  await createSession({
    id: sessionId,
    identityAddress: null,
    origin: originStr,
    protocolVersion,
    clientName: params.clientInfo?.name ?? null,
    clientVersion: params.clientInfo?.version ?? null,
  });

  reply.header('Mcp-Session-Id', sessionId);
  return reply.code(200).send(
    rpcOk(body.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
        completion: {},
        logging: {},
        // MCP 2025-06-18 elicitation: server can request additional info from
        // users mid-interaction. AMBER uses this to prompt for a missing
        // identity address before running any identity-scoped tool (rather
        // than failing with -32602). Full spec at
        // /specification/2025-06-18/client/elicitation.
        elicitation: {},
      },
      serverInfo: {
        name: 'amber',
        title: 'AMBER — Reputation Memory Layer for OKX AI',
        version: '1.0.0',
      },
    })
  );
};

const requireSession = async (
  req: FastifyRequest,
  reply: FastifyReply
): Promise<{ id: string } | null> => {
  const raw = req.headers['mcp-session-id'];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) {
    await handleError(
      reply,
      400,
      'Mcp-Session-Id header is required after initialize',
      AmberErrorCodes.MCP_SESSION_INVALID
    );
    return null;
  }
  const session = await touchSession(id);
  if (!session) {
    await handleError(
      reply,
      404,
      'Mcp-Session-Id not found or expired',
      AmberErrorCodes.MCP_SESSION_INVALID
    );
    return null;
  }
  return { id: session.id };
};

const dispatchToolsCall = async (
  req: FastifyRequest,
  reply: FastifyReply,
  body: JsonRpcRequest
): Promise<FastifyReply> => {
  const params = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
  const name = params.name;
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  if (!name || !KNOWN_TOOLS.has(name)) {
    return reply.code(200).send(rpcErr(body.id, -32602, `unknown tool: ${name}`));
  }

  const identityRaw = args.identity;
  // Public tools keyed by memoryId or no identity at all.
  const identityOptional =
    name === 'memory_verify_attestation' ||
    name === 'amber_onboarding' ||
    name === 'amber_judging_pack' ||
    name === 'amber_live_stats';
  if (!identityOptional && typeof identityRaw !== 'string') {
    return reply.code(200).send(rpcErr(body.id, -32602, 'identity argument is required'));
  }

  try {
    let payload: unknown;
    // resource_link content items appended alongside text content (MCP 2025-06-18).
    const resourceLinks: Array<{ uri: string; name: string; description?: string; mimeType?: string }> = [];

    switch (name) {
      case 'memory_write': {
        const parsed = WriteMemoryRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        const identity = await getOrCreateIdentity(parsed.data.identity);
        const quota = await getOrCreateQuota(identity.id);
        const bypassPayment = hasFreeCapacity(quota);

        if (!bypassPayment) {
          const paymentResult = await x402Exact(req, reply, {
            priceAtomic: PRICE_WRITE_ATOMIC,
            endpoint: `/mcp:${name}`,
            identityInBody: parsed.data.identity,
            method: 'POST',
            inputSchema: WriteMemoryBodySchema,
          });
          if (paymentResult === 'reply-sent') return reply;
        }

        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        const result = await writeOne({
          identityAddress: parsed.data.identity,
          content: parsed.data.content,
          category: parsed.data.category ?? 'note',
          tags: parsed.data.tags ?? [],
          metadata: parsed.data.metadata ?? {},
          clientNonce: parsed.data.clientNonce ?? null,
          paymentMode: bypassPayment ? 'free' : 'paid',
        });
        const attestation = result.replay
          ? await attestationRefFromMemoryId(result.memoryId)
          : pendingAttestationRef();
        payload = {
          memoryId: result.memoryId,
          createdAt: result.createdAt,
          attestation,
          quota: { freeRemaining: result.freeRemaining },
          replay: result.replay,
        };
        // MCP 2025-06-18 resource_link: let the client navigate to the portrait.
        resourceLinks.push({
          uri: `amber://${parsed.data.identity.toLowerCase()}/portrait`,
          name: 'Memory Portrait',
          description: 'Updated constellation portrait for this identity',
          mimeType: 'image/svg+xml',
        });
        break;
      }

      case 'memory_query': {
        const parsed = QueryMemoryRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        const paymentResult = await x402Exact(req, reply, {
          priceAtomic: PRICE_QUERY_ATOMIC,
          endpoint: `/mcp:${name}`,
          identityInBody: parsed.data.identity,
          method: 'POST',
          inputSchema: QueryMemoryQuerySchema,
        });
        if (paymentResult === 'reply-sent') return reply;

        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        const results = await queryTopK({
          identityAddress: parsed.data.identity,
          q: parsed.data.q,
          k: parsed.data.k,
          category: parsed.data.category ?? null,
          since: parsed.data.since ?? null,
          minRelevance: parsed.data.minRelevance,
        });
        payload = { results };
        break;
      }

      case 'memory_bulk_write': {
        const parsed = BulkWriteRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        // Match REST: charge PRICE_WRITE_ATOMIC × over-cap items.
        const bulkIdentity = await getOrCreateIdentity(parsed.data.identity);
        const bulkQuota = await getOrCreateQuota(bulkIdentity.id);
        const bulkFreeAvailable = Math.max(0, FREE_TIER_WRITES_PER_IDENTITY - bulkQuota.freeUsed);
        const bulkTotal = parsed.data.items.length;
        const bulkFreeItems = Math.min(bulkFreeAvailable, bulkTotal);
        const bulkPaidItemsNeeded = Math.max(0, bulkTotal - bulkFreeItems);

        if (bulkPaidItemsNeeded > 0) {
          const paymentResult = await x402Exact(req, reply, {
            priceAtomic: PRICE_WRITE_ATOMIC * bulkPaidItemsNeeded,
            endpoint: `/mcp:${name}`,
            identityInBody: parsed.data.identity,
            method: 'POST',
            inputSchema: BulkWriteBodySchema,
          });
          if (paymentResult === 'reply-sent') return reply;
        }

        const rate = await incrementRate(
          parsed.data.identity,
          `/mcp:${name}`,
          RATE_LIMIT_BULK_PER_MIN
        );
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        const bulk = await writeBulk(
          parsed.data.identity,
          parsed.data.items.map((it) => ({
            content: it.content,
            category: it.category ?? 'note',
            tags: it.tags ?? [],
            metadata: it.metadata ?? {},
            clientNonce: it.clientNonce ?? null,
          })),
          { paidItems: bulkPaidItemsNeeded, freeItems: bulkFreeItems }
        );
        const results = bulk.perItem.map((entry) =>
          entry.ok
            ? { ok: true as const, memoryId: entry.memoryId }
            : {
                ok: false as const,
                error: { code: entry.code, message: entry.message, index: entry.index },
              }
        );
        payload = {
          results,
          attestation: pendingAttestationRef(),
          paidItems: bulkPaidItemsNeeded,
          freeItems: bulkFreeItems,
        };
        break;
      }

      case 'memory_session_context': {
        const parsed = SessionContextRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        const paymentResult = await x402Exact(req, reply, {
          priceAtomic: PRICE_SESSION_CONTEXT_ATOMIC,
          endpoint: `/mcp:${name}`,
          identityInBody: parsed.data.identity,
          method: 'POST',
          inputSchema: SessionContextQuerySchema,
        });
        if (paymentResult === 'reply-sent') return reply;

        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        payload = await fetchSessionContext({
          identityAddress: parsed.data.identity,
          limit: parsed.data.limit,
        });
        break;
      }

      case 'memory_list': {
        const parsed = ListMemoriesRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        payload = await listMemories({
          identityAddress: parsed.data.identity,
          limit: parsed.data.limit,
          cursor: parsed.data.cursor ?? null,
          category: parsed.data.category ?? null,
        });
        break;
      }

      case 'memory_delete': {
        const parsed = DeleteMemoryRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        payload = await softDeleteMemory(parsed.data.identity, parsed.data.memoryId);
        break;
      }

      case 'memory_get': {
        const identityAddr = typeof args.identity === 'string' ? args.identity : '';
        const memId = typeof args.memoryId === 'string' ? args.memoryId : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        if (!memId) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'memoryId is required'));
        }

        const getPayment = await x402Exact(req, reply, {
          priceAtomic: PRICE_QUERY_ATOMIC,
          endpoint: `/mcp:${name}`,
          identityInBody: identityAddr,
          method: 'POST',
          inputSchema: {
            type: 'object',
            required: ['identity', 'memoryId'],
            properties: {
              identity: { type: 'string' },
              memoryId: { type: 'string' },
            },
          },
        });
        if (getPayment === 'reply-sent') return reply;

        try {
          payload = await getMemoryById(identityAddr, memId);
        } catch (err) {
          const code = (err as Error & { code?: string }).code;
          if (code === 'MEMORY_NOT_FOUND') {
            return reply.code(200).send(rpcOk(body.id, { content: [{ type: 'text', text: 'memory not found' }], isError: true }));
          }
          if (code === 'MEMORY_FORBIDDEN') {
            return reply.code(200).send(rpcErr(body.id, -32600, 'identity does not own this memory'));
          }
          throw err;
        }
        break;
      }

      case 'memory_seed_wallet': {
        const parsed = WalletSeedRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`, RATE_LIMIT_BULK_PER_MIN);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        payload = await seedWalletMemories({
          identityAddress: parsed.data.identity,
          lookbackBlocks: parsed.data.lookbackBlocks,
        });
        break;
      }

      case 'memory_verify_attestation': {
        const parsed = VerifyAttestationRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        const view = await getMemoryAttestationView(parsed.data.memoryId);
        if (!view) {
          return reply.code(200).send(
            rpcOk(body.id, {
              content: [{ type: 'text', text: 'memory not found' }],
              isError: true,
            })
          );
        }
        payload = view;
        break;
      }

      case 'seal_generate': {
        const parsed = GenerateSealRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        const paymentResult = await x402Exact(req, reply, {
          priceAtomic: PRICE_SEAL_ATOMIC,
          endpoint: `/mcp:${name}`,
          identityInBody: parsed.data.identity,
          method: 'POST',
          inputSchema: GenerateSealBodySchema,
        });
        if (paymentResult === 'reply-sent') return reply;

        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        payload = await generateSeal({
          identityAddress: parsed.data.identity,
          subject: parsed.data.subject,
          decreeText: parsed.data.decreeText,
          sigilStyle: parsed.data.sigilStyle,
        });
        break;
      }

      case 'portrait_get': {
        const identityAddr = typeof args.identity === 'string' ? args.identity : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        const portraitUrl = `${PUBLIC_BASE_URL}/portrait/${identityAddr.toLowerCase()}.svg`;
        payload = {
          svgUrl: portraitUrl,
          metaUrl: `${PUBLIC_BASE_URL}/portrait/${identityAddr.toLowerCase()}`,
          identity: identityAddr.toLowerCase(),
          description: 'Memory constellation portrait — a living SVG star-chart of your agent memories.',
        };
        break;
      }

      case 'memory_share': {
        const parsed = ShareMemoriesRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }
        const destQuota = await getOrCreateQuota(
          (await getOrCreateIdentity(parsed.data.toIdentity)).id
        );
        const freeLeft = Math.max(0, FREE_TIER_WRITES_PER_IDENTITY - destQuota.freeUsed);
        const paidNeeded = Math.max(0, parsed.data.memoryIds.length - freeLeft);
        if (paidNeeded > 0) {
          const paymentResult = await x402Exact(req, reply, {
            priceAtomic: PRICE_WRITE_ATOMIC * paidNeeded,
            endpoint: `/mcp:${name}`,
            identityInBody: parsed.data.identity,
            method: 'POST',
            inputSchema: ShareMemoriesBodySchema,
          });
          if (paymentResult === 'reply-sent') return reply;
        }
        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`, RATE_LIMIT_BULK_PER_MIN);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        payload = await shareMemories({
          fromIdentity: parsed.data.identity,
          toIdentity: parsed.data.toIdentity,
          memoryIds: parsed.data.memoryIds,
        });
        break;
      }

      case 'memory_consolidate': {
        const parsed = ConsolidateMemoriesRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }
        const identity = await getOrCreateIdentity(parsed.data.identity);
        const quota = await getOrCreateQuota(identity.id);
        if (!hasFreeCapacity(quota)) {
          const paymentResult = await x402Exact(req, reply, {
            priceAtomic: PRICE_WRITE_ATOMIC,
            endpoint: `/mcp:${name}`,
            identityInBody: parsed.data.identity,
            method: 'POST',
            inputSchema: ConsolidateMemoriesBodySchema,
          });
          if (paymentResult === 'reply-sent') return reply;
        }
        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        payload = await consolidateMemories({
          identityAddress: parsed.data.identity,
          limit: parsed.data.limit,
        });
        break;
      }

      case 'memory_demo_pack': {
        const parsed = DemoPackRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }
        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`, 3);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        payload = await runDemoPack({
          identityAddress: parsed.data.identity,
          preference: parsed.data.preference,
        });
        break;
      }

      case 'identity_stats': {
        const identityAddr = typeof args.identity === 'string' ? args.identity : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        payload = await getIdentityStatsSafe(identityAddr);
        break;
      }

      case 'amber_onboarding': {
        payload = await buildOnboardingManifest();
        break;
      }

      case 'portfolio_snapshot': {
        const identityAddr = typeof args.identity === 'string' ? args.identity : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        const portfolio = await getOkxWalletPortfolio(identityAddr.toLowerCase());
        const fetchedAt = new Date().toISOString();
        const topTokens = portfolio.tokens.slice(0, 10);

        // Write portfolio snapshot as a persistent memory (free, idempotent per day).
        let memoryId: string | null = null;
        if (Number(portfolio.totalUsdValue) > 0) {
          const tokenSummary = topTokens
            .map((t) => `${t.symbol}: $${parseFloat(t.usdValue).toFixed(2)}`)
            .join(', ');
          const content = `Portfolio snapshot on X Layer for ${identityAddr.toLowerCase()}. Total value: $${parseFloat(portfolio.totalUsdValue).toFixed(2)} USD. Tokens: ${tokenSummary || 'none detected'}.`;
          try {
            const day = fetchedAt.slice(0, 10); // YYYY-MM-DD for daily idempotency
            const w = await writeOne({
              identityAddress: identityAddr.toLowerCase(),
              content,
              category: 'fact',
              tags: ['portfolio', 'xlayer', 'okx-dex', 'snapshot'],
              metadata: { source: 'portfolio_snapshot', totalUsdValue: portfolio.totalUsdValue, day },
              clientNonce: `portfolio:${identityAddr.toLowerCase()}:${day}`,
              paymentMode: 'free',
            });
            memoryId = w.memoryId;
          } catch (err) {
            // Non-fatal — still return the portfolio data even if memory write fails.
            console.warn('[portfolio_snapshot] memory write failed:', (err as Error).message);
          }
        }

        payload = {
          identity: identityAddr.toLowerCase(),
          totalUsdValue: portfolio.totalUsdValue,
          tokens: topTokens,
          memoryId,
          portfolioUrl: `https://web3.okx.com/portfolio?address=${identityAddr}`,
          fetchedAt,
        };
        break;
      }

      case 'memory_analytics': {
        const identityAddr = typeof args.identity === 'string' ? args.identity : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        const analytics = await buildAnalytics(identityAddr.toLowerCase());
        payload = {
          ...analytics,
          analyticsUrl: `${PUBLIC_BASE_URL}/analytics/${identityAddr.toLowerCase()}`,
        };
        break;
      }

      case 'memory_graph': {
        const identityAddr = typeof args.identity === 'string' ? args.identity : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        const graph = await buildGraph(identityAddr.toLowerCase());
        payload = {
          ...graph,
          graphUrl: `${PUBLIC_BASE_URL}/graph/${identityAddr.toLowerCase()}`,
        };
        break;
      }

      case 'memory_whoami': {
        const parsed = WhoAmIRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }
        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`, 30);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        payload = await whoAmI(parsed.data.identity);
        break;
      }

      case 'memory_diff': {
        const parsed = SessionDiffRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }
        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`, 30);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        payload = await sessionDiff(parsed.data.identity, parsed.data.since);
        break;
      }

      case 'memory_pin': {
        const parsed = PinMemoryRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }
        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`, 30);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        payload = await setMemoryPinned(
          parsed.data.identity,
          parsed.data.memoryId,
          parsed.data.pinned ?? true
        );
        break;
      }

      case 'memory_portability_pack': {
        const parsed = PortabilityPackRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }
        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`, 30);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        payload = await buildPortabilityPack({
          identityAddress: parsed.data.identity,
          limit: parsed.data.limit,
          since: parsed.data.since ?? null,
        });
        break;
      }

      case 'amber_judging_pack': {
        payload = await buildJudgingPack();
        break;
      }

      case 'finance_brief': {
        const identityAddr = typeof args.identity === 'string' ? args.identity : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        const rate = await incrementRate(identityAddr.toLowerCase(), `/mcp:${name}`, 10);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        payload = await buildFinanceBrief(identityAddr);
        break;
      }

      case 'lifestyle_remember': {
        const identityAddr = typeof args.identity === 'string' ? args.identity : '';
        const content = typeof args.content === 'string' ? args.content : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        if (!content.trim()) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'content is required'));
        }
        const kindRaw = typeof args.kind === 'string' ? args.kind : 'preference';
        const kind =
          kindRaw === 'fact' || kindRaw === 'goal' || kindRaw === 'preference' ? kindRaw : 'preference';
        const pin = typeof args.pin === 'boolean' ? args.pin : true;
        const rate = await incrementRate(identityAddr.toLowerCase(), `/mcp:${name}`, 20);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        try {
          payload = await lifestyleRemember({
            identityAddress: identityAddr,
            content,
            kind,
            pin,
          });
        } catch (err) {
          if ((err as { code?: string }).code === 'MEMORY_INJECTION_REJECTED') {
            return reply.code(200).send(rpcErr(body.id, -32602, (err as Error).message));
          }
          throw err;
        }
        break;
      }

      // ── New tools ─────────────────────────────────────────────────────────

      case 'amber_live_stats': {
        const rate = await incrementRate('global:amber_live_stats', '/mcp:amber_live_stats', 60);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }
        const [stats24h, statsAllTime] = await Promise.all([
          collectAmberStats(24),
          collectAmberStats(24 * 365 * 10), // effectively all-time
        ]);
        payload = {
          snapshot: 'real-time',
          basis:
            'usdtVolume is ON-CHAIN SETTLED USD₮0 only (txHash present, verifiable on X Layer). usdtAuthorized includes verified EIP-3009 signatures not yet settled; usdtPending is the difference awaiting settlement.',
          last24h: {
            memoriesWritten: stats24h.memories.writtenInWindow,
            activeIdentities: stats24h.identities.activeInWindow,
            paymentsCount: stats24h.payments.settledOnChainInWindow,
            authorizedPaymentsCount: stats24h.payments.receiptCountInWindow,
            usdtVolume: stats24h.payments.settledPaidUsdtInWindow,
            usdtAuthorized: stats24h.payments.totalPaidUsdtInWindow,
            usdtPending: stats24h.payments.pendingPaidUsdtInWindow,
            attestedBatches: stats24h.memories.attestedInWindow,
          },
          allTime: {
            totalIdentities: statsAllTime.identities.total,
            totalMemories: statsAllTime.memories.totalActive,
            totalPaymentsCount: statsAllTime.payments.settledOnChainInWindow,
            totalAuthorizedPaymentsCount: statsAllTime.payments.receiptCountInWindow,
            totalUsdtVolume: statsAllTime.payments.settledPaidUsdtInWindow,
            totalUsdtAuthorized: statsAllTime.payments.totalPaidUsdtInWindow,
            totalUsdtPending: statsAllTime.payments.pendingPaidUsdtInWindow,
            freeWritesConsumed: statsAllTime.quota.freeWritesConsumed,
            paidWrites: statsAllTime.quota.paidWrites,
            paidQueries: statsAllTime.quota.paidQueries,
          },
          topCategories: stats24h.topCategories,
          attestationQueue: stats24h.queue.pendingAttestationsDepth,
          network: `X Layer (eip155:${XLAYER_CHAIN_ID})`,
          asset: `USDT (${USDT_XLAYER_ADDRESS})`,
          protocol: 'x402 v2, EIP-3009',
          mcpVersion: '2025-06-18',
          tools: tools.length,
          generatedAt: new Date().toISOString(),
        };
        break;
      }

      case 'daily_brief': {
        const identityAddr = typeof args.identity === 'string' ? args.identity.toLowerCase() : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        const rawHours = args.lookbackHours;
        const lookbackHours =
          typeof rawHours === 'number' && rawHours >= 1 && rawHours <= 72
            ? Math.floor(rawHours)
            : 24;
        const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

        const rate = await incrementRate(identityAddr, `/mcp:${name}`, 10);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        // Use sessionDiff (which gets memories since a timestamp) for daily brief.
        const diff = await sessionDiff(identityAddr, since.toISOString());

        // Category breakdown from the diff
        const catCount: Record<string, number> = {};
        for (const m of diff.added) {
          catCount[m.category] = (catCount[m.category] ?? 0) + 1;
        }
        const categoryBreakdown = Object.entries(catCount)
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count);

        payload = {
          identity: identityAddr,
          lookbackHours,
          since: since.toISOString(),
          newMemoriesCount: diff.count,
          categoryBreakdown,
          recentMemories: diff.added.slice(0, 10).map((m) => ({
            memoryId: m.memoryId,
            category: m.category,
            content: m.content.length > 200 ? `${m.content.slice(0, 200)}…` : m.content,
            tags: m.tags,
            createdAt: m.createdAt,
          })),
          note: diff.count === 0
            ? `No new memories in the last ${lookbackHours}h. Use memory_write to start building context.`
            : `${diff.count} new memories in the last ${lookbackHours}h.`,
          portraitUrl: `${PUBLIC_BASE_URL}/portrait/${identityAddr}.svg`,
          nextPrompts: [
            `Call memory_whoami with identity=${identityAddr} for full context.`,
            `Call finance_brief with identity=${identityAddr} for portfolio update.`,
            `Call memory_query with identity=${identityAddr} and q="what changed recently" to search new memories.`,
          ],
          generatedAt: new Date().toISOString(),
        };
        // Link to portrait resource
        resourceLinks.push({
          uri: `amber://${identityAddr}/portrait`,
          name: 'Memory Portrait',
          description: 'Constellation portrait showing memory activity',
          mimeType: 'image/svg+xml',
        });
        break;
      }

      case 'memory_goal_set': {
        const identityAddr = typeof args.identity === 'string' ? args.identity.toLowerCase() : '';
        const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        if (!goal) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'goal is required'));
        }
        const deadline = typeof args.deadline === 'string' && args.deadline.trim() ? args.deadline.trim() : null;
        const priorityRaw = typeof args.priority === 'string' ? args.priority : 'medium';
        const priority =
          priorityRaw === 'high' || priorityRaw === 'low' || priorityRaw === 'medium'
            ? priorityRaw
            : 'medium';

        const rate = await incrementRate(identityAddr, `/mcp:${name}`, 20);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        const goalContent = deadline
          ? `Goal: ${goal}. Deadline: ${deadline}. Priority: ${priority}.`
          : `Goal: ${goal}. Priority: ${priority}.`;

        // Use 'task' category (the closest to 'goal' in MemoryCategory enum).
        const goalIdentity = await getOrCreateIdentity(identityAddr);
        const goalQuota = await getOrCreateQuota(goalIdentity.id);
        const bypassPaymentGoal = hasFreeCapacity(goalQuota);
        if (!bypassPaymentGoal) {
          const paymentResult = await x402Exact(req, reply, {
            priceAtomic: PRICE_WRITE_ATOMIC,
            endpoint: `/mcp:${name}`,
            identityInBody: identityAddr,
            method: 'POST',
            inputSchema: {
              type: 'object',
              required: ['identity', 'goal'],
              properties: {
                identity: { type: 'string' },
                goal: { type: 'string' },
              },
            },
          });
          if (paymentResult === 'reply-sent') return reply;
        }

        const today = new Date().toISOString().slice(0, 10);
        const nonce = `goal:${identityAddr}:${Buffer.from(goal).toString('base64url').slice(0, 16)}:${today}`;

        const goalWriteResult = await writeOne({
          identityAddress: identityAddr,
          content: goalContent,
          category: 'task',
          tags: ['goal', 'lifestyle', priority],
          metadata: { source: 'memory_goal_set', priority, ...(deadline ? { deadline } : {}) },
          clientNonce: nonce,
          paymentMode: bypassPaymentGoal ? 'free' : 'paid',
        });

        // Pin the goal so it surfaces in whoami.
        await setMemoryPinned(identityAddr, goalWriteResult.memoryId, true);
        const whoamiData = await whoAmI(identityAddr);

        payload = {
          identity: identityAddr,
          memoryId: goalWriteResult.memoryId,
          goal,
          deadline,
          priority,
          pinned: true,
          freeRemaining: goalWriteResult.freeRemaining,
          replay: goalWriteResult.replay,
          whoami: whoamiData,
          portraitUrl: `${PUBLIC_BASE_URL}/portrait/${identityAddr}.svg`,
          nextPrompts: [
            `Track progress: memory_query with identity=${identityAddr} and q="${goal.slice(0, 60)}"`,
            `Update status: lifestyle_remember with category=fact to record milestones`,
            `See all goals: memory_list with identity=${identityAddr}`,
          ],
        };
        resourceLinks.push({
          uri: `amber://${identityAddr}/portrait`,
          name: 'Memory Portrait',
          description: 'Updated portrait with your new goal pinned',
          mimeType: 'image/svg+xml',
        });
        break;
      }

      case 'memory_related': {
        const parsed = RelatedMemoryRequestSchema.safeParse(args);
        if (!parsed.success) {
          return reply.code(200).send(rpcErr(body.id, -32602, parsed.error.message));
        }

        const paymentResult = await x402Exact(req, reply, {
          priceAtomic: PRICE_QUERY_ATOMIC,
          endpoint: `/mcp:${name}`,
          identityInBody: parsed.data.identity,
          method: 'POST',
          inputSchema: RelatedMemoryBodySchema,
        });
        if (paymentResult === 'reply-sent') return reply;

        const rate = await incrementRate(parsed.data.identity, `/mcp:${name}`);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        try {
          const results = await queryRelated({
            identityAddress: parsed.data.identity,
            memoryId: parsed.data.memoryId,
            k: parsed.data.k,
            minRelevance: parsed.data.minRelevance,
          });
          payload = {
            seed: parsed.data.memoryId,
            results,
            count: results.length,
          };
        } catch (err) {
          if ((err as { code?: string }).code === 'MEMORY_NOT_FOUND') {
            return reply.code(200).send(rpcErr(body.id, -32602, 'seed memory not found'));
          }
          throw err;
        }
        break;
      }

      case 'memory_habit_check': {
        const identityAddr = typeof args.identity === 'string' ? args.identity.toLowerCase() : '';
        const habit = typeof args.habit === 'string' ? args.habit.trim() : '';
        const note = typeof args.note === 'string' ? args.note.trim() : '';
        const skipToday = args.skipToday === true;

        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        if (!habit) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'habit is required'));
        }

        const rate = await incrementRate(identityAddr, `/mcp:${name}`, 30);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        // Normalize habit into a stable tag so streak lookups are cheap.
        const habitTag =
          'habit:' +
          habit.slice(0, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-');

        // Free-tier gate.
        const habitIdentity = await getOrCreateIdentity(identityAddr);
        const habitQuota = await getOrCreateQuota(habitIdentity.id);
        const bypassPayment = hasFreeCapacity(habitQuota);
        if (!bypassPayment) {
          const paymentResult = await x402Exact(req, reply, {
            priceAtomic: PRICE_WRITE_ATOMIC,
            endpoint: `/mcp:${name}`,
            identityInBody: identityAddr,
            method: 'POST',
            inputSchema: {
              type: 'object',
              required: ['identity', 'habit'],
              properties: {
                identity: { type: 'string' },
                habit: { type: 'string' },
              },
            },
          });
          if (paymentResult === 'reply-sent') return reply;
        }

        // Pull all prior checkins for this habit — sorted ASC to walk the streak.
        const priorCheckins = await prismaQuery.memory.findMany({
          where: {
            identityId: habitIdentity.id,
            deletedAt: null,
            tags: { hasEvery: ['habit', habitTag] },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, createdAt: true, metadata: true },
        });

        // Streak math: count consecutive UTC days ending today. A missed day
        // resets the streak. skipToday=true resets today as well.
        const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
        const today = dayKey(new Date());
        const priorDayKeys = new Set(priorCheckins.map((c) => dayKey(c.createdAt)));
        const alreadyCheckedToday = priorDayKeys.has(today);

        // Compute longest streak across the full history (deterministic + auditable).
        const sortedDays = Array.from(priorDayKeys).sort();
        let longestStreak = 0;
        let running = 0;
        let prevDay: string | null = null;
        for (const d of sortedDays) {
          if (prevDay === null) {
            running = 1;
          } else {
            const diff = (new Date(d).getTime() - new Date(prevDay).getTime()) / (86400 * 1000);
            running = diff === 1 ? running + 1 : 1;
          }
          if (running > longestStreak) longestStreak = running;
          prevDay = d;
        }

        // Current streak = consecutive UTC days ending on today (or yesterday
        // if we haven't yet checked in today and we're not skipping).
        let currentStreak = 0;
        const endDate = new Date(`${today}T00:00:00Z`);
        // Walk backward day by day; each day that has a checkin extends the streak.
        for (let offset = 0; offset < 3650; offset++) {
          const d = new Date(endDate.getTime() - offset * 86400 * 1000);
          if (priorDayKeys.has(dayKey(d))) {
            currentStreak += 1;
          } else if (offset === 0 && !skipToday) {
            // Today has no checkin yet — that's fine, we're about to write one.
            continue;
          } else {
            break;
          }
        }

        // Write today's checkin as a memory (skipped counts as a reset marker).
        let memoryId: string | null = null;
        let streakAfterWrite = currentStreak;
        const habitContent = skipToday
          ? `Habit "${habit}" — SKIPPED on ${today}. Streak reset.`
          : `Habit "${habit}" — checked in on ${today}${note ? '. Note: ' + note : '.'} Streak: ${currentStreak + (alreadyCheckedToday ? 0 : 1)} day(s).`;

        try {
          const habitNonce = `habit:${identityAddr}:${habitTag}:${today}${skipToday ? ':skip' : ''}`;
          const habitWrite = await writeOne({
            identityAddress: identityAddr,
            content: habitContent,
            category: 'event',
            tags: ['habit', habitTag, 'lifestyle', 'okx-ai', skipToday ? 'habit-skip' : 'habit-checkin'],
            metadata: {
              source: 'memory_habit_check',
              habit,
              day: today,
              streakAtCheckin: skipToday ? 0 : currentStreak + (alreadyCheckedToday ? 0 : 1),
              ...(note ? { note } : {}),
              ...(skipToday ? { skipped: true } : {}),
            },
            clientNonce: habitNonce,
            paymentMode: bypassPayment ? 'free' : 'paid',
          });
          memoryId = habitWrite.memoryId;
          if (!skipToday && !alreadyCheckedToday) streakAfterWrite = currentStreak + 1;
          if (skipToday) streakAfterWrite = 0;
        } catch (err) {
          console.warn('[memory_habit_check] write failed:', (err as Error).message);
        }

        // Pin the habit tag itself once (the first checkin). Pinning
        // subsequent memoryIds would clutter whoami — one pin per habit is
        // the deliberate signal, not one per day.
        if (memoryId && priorCheckins.length === 0 && !skipToday) {
          try {
            await setMemoryPinned(identityAddr, memoryId, true);
          } catch (err) {
            console.warn('[memory_habit_check] pin failed:', (err as Error).message);
          }
        }

        const totalCheckins = priorCheckins.filter((c) => {
          const meta = c.metadata as { skipped?: boolean } | null;
          return !meta?.skipped;
        }).length + (skipToday || alreadyCheckedToday || !memoryId ? 0 : 1);

        const firstCheckin = priorCheckins[0]?.createdAt.toISOString() ?? new Date().toISOString();

        payload = {
          identity: identityAddr,
          habit,
          habitTag,
          memoryId,
          streakCount: streakAfterWrite,
          lastCheckinDate: today,
          totalCheckins,
          skipped: skipToday,
          streakBreakdown: {
            longestStreak: Math.max(longestStreak, streakAfterWrite),
            firstCheckin,
          },
          nextPrompts: skipToday
            ? [
                `Reset acknowledged. memory_habit_check identity=${identityAddr} habit="${habit}" tomorrow to start a new streak.`,
                `Query progress: memory_query identity=${identityAddr} q="${habit} habit streak"`,
              ]
            : [
                `Keep it up: memory_habit_check identity=${identityAddr} habit="${habit}" every day.`,
                `Full lifestyle: memory_whoami identity=${identityAddr}`,
                `Compare to goals: memory_goal_set identity=${identityAddr} goal="Maintain ${habit} for 30 days"`,
              ],
          portraitUrl: `${PUBLIC_BASE_URL}/portrait/${identityAddr}.svg`,
        };
        resourceLinks.push({
          uri: `amber://${identityAddr}/portrait`,
          name: 'Memory Portrait',
          description: `Portrait now shows a habit checkin streak of ${streakAfterWrite} day(s)`,
          mimeType: 'image/svg+xml',
        });
        break;
      }

      case 'memory_reputation_lookup': {
        const identityAddr = typeof args.identity === 'string' ? args.identity.toLowerCase() : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }

        const rate = await incrementRate(identityAddr, `/mcp:${name}`, 60);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        try {
          const rep = await computeReputationScore(identityAddr);
          payload = {
            address: rep.address,
            score: rep.score,
            tier: rep.tier,
            tierIcon: rep.tierIcon,
            summary: rep.summary,
            totalMemories: rep.totalMemories,
            attestationRate: rep.attestationRate,
            breakdown: rep.breakdown,
            firstSeenAt: rep.firstSeenAt,
            lastActiveAt: rep.lastActiveAt,
            portraitUrl: rep.links.portrait,
            statsUrl: rep.links.stats,
            generatedAt: rep.generatedAt,
            nextPrompts: [
              rep.score < 25
                ? `Bootstrap this identity: memory_demo_pack identity=${identityAddr}`
                : `Explore: memory_whoami identity=${identityAddr}`,
              `Deep dive: memory_analytics identity=${identityAddr}`,
              `Query paid: memory_query identity=${identityAddr} q="what defines this identity"`,
            ],
          };
        } catch (err) {
          if (err instanceof ReputationNotFoundError) {
            payload = {
              address: identityAddr,
              score: 0,
              tier: 'unseen',
              tierIcon: '·',
              summary: `· UNSEEN (0/100). Identity ${identityAddr.slice(0, 8)}... has no memories on AMBER yet.`,
              note: 'Run memory_write or memory_demo_pack to bootstrap this identity on AMBER.',
              nextPrompts: [
                `Bootstrap: memory_demo_pack identity=${identityAddr}`,
                `Or: memory_seed_wallet identity=${identityAddr} for on-chain wallet history`,
              ],
            };
          } else {
            throw err;
          }
        }
        break;
      }

      case 'memory_template': {
        const identityAddr = typeof args.identity === 'string' ? args.identity.toLowerCase() : '';
        const vertical = typeof args.vertical === 'string' ? args.vertical : '';
        const templateContent = typeof args.content === 'string' ? args.content.trim() : '';
        const subject = typeof args.subject === 'string' ? args.subject.trim() : '';
        const shouldPin = args.pin === true;

        if (!/^0x[0-9a-fA-F]{40}$/.test(identityAddr)) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'identity must be a valid 0x address'));
        }
        if (!templateContent) {
          return reply.code(200).send(rpcErr(body.id, -32602, 'content is required'));
        }

        // Vertical → (category, tags, crossVerticalRecall) mapping lives in the
        // shared memoryTemplate service so the demo seeder writes through the
        // exact same path. Matches the 5 OKX AI ASP categories announced by
        // @XLayerOfficial. Every memory written through this tool is
        // discoverable by any other ASP with a single `memory_query` on the tag.
        const config = TEMPLATE_VERTICALS[vertical];
        if (!config) {
          return reply.code(200).send(
            rpcErr(body.id, -32602, `vertical must be one of: ${TEMPLATE_VERTICAL_KEYS.join(', ')}`)
          );
        }

        const rate = await incrementRate(identityAddr, `/mcp:${name}`, 30);
        if (!rate.allowed) {
          return reply.code(200).send(
            rpcErr(body.id, -32000, `rate limited (retry after ${rate.retryAfterSeconds}s)`, {
              retryAfterSeconds: rate.retryAfterSeconds,
            })
          );
        }

        // Free-tier bypass for the first 100 writes per identity, else x402.
        const templateIdentity = await getOrCreateIdentity(identityAddr);
        const templateQuota = await getOrCreateQuota(templateIdentity.id);
        const bypassPayment = hasFreeCapacity(templateQuota);
        if (!bypassPayment) {
          const paymentResult = await x402Exact(req, reply, {
            priceAtomic: PRICE_WRITE_ATOMIC,
            endpoint: `/mcp:${name}`,
            identityInBody: identityAddr,
            method: 'POST',
            inputSchema: {
              type: 'object',
              required: ['identity', 'vertical', 'content'],
              properties: {
                identity: { type: 'string' },
                vertical: { type: 'string' },
                content: { type: 'string' },
              },
            },
          });
          if (paymentResult === 'reply-sent') return reply;
        }

        // Delegate the actual write + optional pin to the shared template path.
        const templateWrite = await writeVerticalMemory({
          identityAddress: identityAddr,
          vertical,
          content: templateContent,
          subject,
          pin: shouldPin,
          paymentMode: bypassPayment ? 'free' : 'paid',
        });

        payload = {
          identity: identityAddr,
          memoryId: templateWrite.memoryId,
          vertical,
          subject: subject || null,
          tags: templateWrite.tags,
          category: config.category,
          pinned: templateWrite.pinned,
          replay: templateWrite.replay,
          freeRemaining: templateWrite.freeRemaining,
          crossVerticalRecall: config.recall,
          nextPrompts: [
            config.nextTool,
            `Cross-ASP recall: any OKX AI agent can now find this by memory_query with tag "${vertical.replace('_', '-')}"`,
            `Full context: memory_whoami for ${identityAddr}`,
          ],
          portraitUrl: `${PUBLIC_BASE_URL}/portrait/${identityAddr}.svg`,
        };
        resourceLinks.push({
          uri: `amber://${identityAddr}/portrait`,
          name: 'Memory Portrait',
          description: `Portrait updated with new ${vertical} template memory`,
          mimeType: 'image/svg+xml',
        });
        break;
      }

      default:
        return reply.code(200).send(rpcErr(body.id, -32602, `unhandled tool: ${name}`));
    }

    return reply.code(200).send(
      rpcOk(body.id, {
        content: [
          { type: 'text', text: JSON.stringify(payload) },
          // MCP 2025-06-18: resource_link items let MCP clients navigate to related resources.
          ...resourceLinks.map((r) => ({
            type: 'resource_link' as const,
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          })),
        ],
        // MCP 2025-06-18: structuredContent is the typed equivalent of the text content.
        structuredContent: payload,
        isError: false,
      })
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'MEMORY_NOT_FOUND' || code === 'MEMORY_FORBIDDEN') {
      return reply.code(200).send(
        rpcOk(body.id, {
          content: [{ type: 'text', text: (err as Error).message }],
          isError: true,
        })
      );
    }
    return reply.code(200).send(
      rpcOk(body.id, {
        content: [{ type: 'text', text: (err as Error).message }],
        isError: true,
      })
    );
  }
};

// -----------------------------------------------------------------------------
// MCP Resources (spec 2025-06-18)
// -----------------------------------------------------------------------------

const IDENTITY_REGEX = /^0x[0-9a-fA-F]{40}$/i;

const staticResources = [
  {
    uri: 'amber://system/onboarding',
    name: 'amber_onboarding_manifest',
    title: 'AMBER Onboarding Manifest',
    description:
      'Full Onchain OS onboarding manifest for AMBER: MCP prompts, x402 payment scheme, prize tracks, attestation capability.',
    mimeType: 'application/json',
  },
  {
    uri: 'amber://system/judging',
    name: 'amber_judging_pack',
    title: 'AMBER Judging Pack',
    description:
      'Build X / OKX.AI hackathon evidence packet: criteria, prize strategy, live stats, 90-second demo, checklist.',
    mimeType: 'application/json',
  },
  {
    uri: 'amber://system/listing',
    name: 'amber_listing',
    title: 'AMBER Listing',
    description: 'Public /listing.json summary for the AMBER MCP service.',
    mimeType: 'application/json',
  },
];

const resourceTemplates = [
  {
    uriTemplate: 'amber://{identity}/memories',
    name: 'identity_memories',
    title: 'Identity Memories',
    description:
      'Recent memories (up to 20) for an ERC-8004 identity. Embeddings omitted.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'amber://{identity}/portrait',
    name: 'identity_portrait',
    title: 'Memory Portrait',
    description:
      'Radial SVG constellation portrait of the identity\'s memories.',
    mimeType: 'image/svg+xml',
  },
  {
    uriTemplate: 'amber://{identity}/analytics',
    name: 'identity_analytics',
    title: 'Identity Analytics',
    description:
      'Category breakdown, daily timeline, top tags, attestation and seal stats.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'amber://{identity}/dossier',
    name: 'identity_dossier',
    title: 'Identity Dossier',
    description:
      'Latest deterministic dossier memory (tagged "dossier" or "consolidate") for the identity.',
    mimeType: 'application/json',
  },
];

interface ParsedResourceUri {
  host: string; // e.g. "system" or the identity address
  path: string; // e.g. "onboarding", "memories"
}

const parseAmberUri = (uri: string): ParsedResourceUri | null => {
  const match = /^amber:\/\/([^/]+)\/([^/?#]+)$/.exec(uri);
  if (!match) return null;
  return { host: match[1]!, path: match[2]! };
};

const buildListingSummary = (): Record<string, unknown> => ({
  name: 'AMBER',
  description:
    'AMBER is the persistent memory layer for the OKX AI marketplace. Every ASP category (professional asset creation, resume workflows, creative pipelines, software services, prediction markets) can write and recall context keyed on the user ERC-8004 identity. 32 MCP tools including memory_template with 5-vertical presets, memory_related pgvector KNN, and memory_habit_check with streak tracking. Merkle-attested on X Layer. SEALSCRIBE wax-seal keepsakes, Memory Portrait constellation art, and OG-image PNG cards included. Paid via x402 USDT — first 100 writes per identity free. A2A envelope routing supported.',
  category: 'Software Utility',
  tracks: [
    'Best Product',
    'Creative Genius',
    'Revenue Rocket',
    'Finance Copilot',
    'Software Utility',
    'Artistic Excellence',
    'Social Buzz',
  ],
  endpoint: `${PUBLIC_BASE_URL}/mcp`,
  listingUrl: `${PUBLIC_BASE_URL}/listing.json`,
  chain: { id: XLAYER_CHAIN_ID, name: 'X Layer' },
  payment: { asset: USDT_XLAYER_ADDRESS, schemes: ['exact'] },
});

const dispatchResourcesList = (
  reply: FastifyReply,
  body: JsonRpcRequest
): FastifyReply => {
  return reply.code(200).send(rpcOk(body.id, { resources: staticResources }));
};

const dispatchResourcesTemplatesList = (
  reply: FastifyReply,
  body: JsonRpcRequest
): FastifyReply => {
  return reply
    .code(200)
    .send(rpcOk(body.id, { resourceTemplates }));
};

const jsonResourceContent = (
  uri: string,
  payload: unknown
): { contents: Array<{ uri: string; mimeType: string; text: string }> } => ({
  contents: [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(payload),
    },
  ],
});

const dispatchResourcesRead = async (
  reply: FastifyReply,
  body: JsonRpcRequest
): Promise<FastifyReply> => {
  const params = (body.params ?? {}) as { uri?: unknown };
  const uri = typeof params.uri === 'string' ? params.uri : '';
  if (!uri) {
    return reply.code(200).send(rpcErr(body.id, -32602, 'uri parameter is required'));
  }
  const parsed = parseAmberUri(uri);
  if (!parsed) {
    return reply
      .code(200)
      .send(rpcErr(body.id, -32602, `unsupported resource uri: ${uri}`));
  }

  try {
    // Static system resources.
    if (parsed.host === 'system') {
      switch (parsed.path) {
        case 'onboarding': {
          const manifest = await buildOnboardingManifest();
          return reply.code(200).send(rpcOk(body.id, jsonResourceContent(uri, manifest)));
        }
        case 'judging': {
          const pack = await buildJudgingPack();
          return reply.code(200).send(rpcOk(body.id, jsonResourceContent(uri, pack)));
        }
        case 'listing': {
          return reply
            .code(200)
            .send(rpcOk(body.id, jsonResourceContent(uri, buildListingSummary())));
        }
        default:
          return reply
            .code(200)
            .send(rpcErr(body.id, -32002, `resource not found: ${uri}`));
      }
    }

    // Identity-scoped resources: host must be a 0x address.
    if (!IDENTITY_REGEX.test(parsed.host)) {
      return reply
        .code(200)
        .send(rpcErr(body.id, -32602, 'identity in resource uri must be a valid 0x address'));
    }
    const identityAddr = parsed.host.toLowerCase();

    switch (parsed.path) {
      case 'memories': {
        const result = await listMemories({
          identityAddress: identityAddr,
          limit: 20,
          cursor: null,
          category: null,
        });
        const trimmed = result.memories.map((m) => ({
          id: m.memoryId,
          content: m.content,
          category: m.category,
          tags: m.tags,
          createdAt: m.createdAt,
        }));
        return reply.code(200).send(
          rpcOk(
            body.id,
            jsonResourceContent(uri, {
              identity: identityAddr,
              total: result.total,
              memories: trimmed,
            })
          )
        );
      }
      case 'portrait': {
        const svg = await getOrGeneratePortrait(identityAddr);
        if (!svg) {
          return reply
            .code(200)
            .send(rpcErr(body.id, -32002, `no memories yet — portrait unavailable for ${identityAddr}`));
        }
        return reply.code(200).send(
          rpcOk(body.id, {
            contents: [
              {
                uri,
                mimeType: 'image/svg+xml',
                text: svg,
              },
            ],
          })
        );
      }
      case 'analytics': {
        const analytics = await buildAnalytics(identityAddr);
        return reply.code(200).send(
          rpcOk(
            body.id,
            jsonResourceContent(uri, {
              ...analytics,
              analyticsUrl: `${PUBLIC_BASE_URL}/analytics/${identityAddr}`,
            })
          )
        );
      }
      case 'dossier': {
        const identity = await getOrCreateIdentity(identityAddr);
        const dossier = await prismaQuery.memory.findFirst({
          where: {
            identityId: identity.id,
            deletedAt: null,
            OR: [{ tags: { has: 'dossier' } }, { tags: { has: 'consolidate' } }],
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, content: true, metadata: true },
        });
        if (!dossier) {
          return reply.code(200).send(
            rpcOk(
              body.id,
              jsonResourceContent(uri, {
                identity: identityAddr,
                dossier: null,
                message: 'no dossier yet — run memory_consolidate or memory_demo_pack to build one',
              })
            )
          );
        }
        return reply.code(200).send(
          rpcOk(
            body.id,
            jsonResourceContent(uri, {
              identity: identityAddr,
              dossier: {
                memoryId: dossier.id,
                content: dossier.content,
                metadata: dossier.metadata,
              },
            })
          )
        );
      }
      default:
        return reply
          .code(200)
          .send(rpcErr(body.id, -32002, `resource not found: ${uri}`));
    }
  } catch (err) {
    return reply
      .code(200)
      .send(rpcErr(body.id, -32603, `failed to read resource: ${(err as Error).message}`));
  }
};

// -----------------------------------------------------------------------------
// MCP Prompts (spec 2025-06-18)
// -----------------------------------------------------------------------------

interface PromptArgumentSpec {
  name: string;
  description?: string;
  required: boolean;
}

interface PromptSpec {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgumentSpec[];
  build: (args: Record<string, string>) => string;
}

const interpolate = (
  template: string,
  args: Record<string, string>,
  defaults: Record<string, string> = {}
): string =>
  template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)(\|([^}]*))?\}/g, (_m, key, _pipe, fallback) => {
    const provided = args[key];
    if (provided && provided.length > 0) return provided;
    if (fallback !== undefined) return fallback;
    if (defaults[key] !== undefined) return defaults[key]!;
    return `{${key}}`;
  });

const prompts: PromptSpec[] = [
  {
    name: 'amber_onboard',
    title: 'Bootstrap AMBER for your identity',
    description: 'Bootstrap AMBER for your identity',
    arguments: [
      {
        name: 'identity',
        description: 'ERC-8004 identity address (0x...)',
        required: true,
      },
    ],
    build: (args) =>
      interpolate(
        'You are connected to AMBER, a persistent memory MCP for AI agents. Run these steps for identity {identity}:\n' +
          '1. Call finance_brief to seed wallet history and get a portfolio snapshot.\n' +
          '2. Call memory_demo_pack to write a preference and build a dossier.\n' +
          '3. Call memory_whoami to see everything AMBER knows about you.\n' +
          '4. Open the portrait SVG at {PUBLIC_BASE_URL}/portrait/{identity}.svg for visual proof.',
        args,
        { PUBLIC_BASE_URL }
      ),
  },
  {
    name: 'amber_recall',
    title: 'Recall from AMBER memory',
    description: 'Recall from AMBER memory',
    arguments: [
      { name: 'identity', description: 'ERC-8004 identity address (0x...)', required: true },
      { name: 'query', description: 'What to search for', required: true },
    ],
    build: (args) =>
      interpolate(
        'Use the memory_query tool with identity={identity} and q={query} to recall relevant memories from AMBER. Return the top results with their content and relevance scores.',
        args
      ),
  },
  {
    name: 'amber_finance',
    title: 'Finance Copilot briefing',
    description: 'Finance Copilot briefing',
    arguments: [
      { name: 'identity', description: 'ERC-8004 identity address (0x...)', required: true },
    ],
    build: (args) =>
      interpolate(
        'Run the finance_brief tool for identity={identity}. This will: 1) seed X Layer wallet history into memory, 2) capture OKX portfolio snapshot, 3) recall all financial context. Then summarize the portfolio value, top holdings, and any notable financial events.',
        args
      ),
  },
  {
    name: 'amber_whoami',
    title: 'Identity summary from AMBER',
    description: 'Identity summary from AMBER',
    arguments: [
      { name: 'identity', description: 'ERC-8004 identity address (0x...)', required: true },
    ],
    build: (args) =>
      interpolate(
        'Call memory_whoami with identity={identity} to get a full identity summary from AMBER. Include preferences, facts, pinned memories, dossier, and the portrait URL. Answer: who am I?',
        args
      ),
  },
  {
    name: 'amber_session_boot',
    title: 'Bootstrap a new agent session',
    description: 'Bootstrap a new agent session',
    arguments: [
      { name: 'identity', description: 'ERC-8004 identity address (0x...)', required: true },
      { name: 'limit', description: 'Number of memories (default 10)', required: false },
    ],
    build: (args) =>
      interpolate(
        'Call memory_session_context with identity={identity} and limit={limit|10} to load the most recent memories and boot a persistent context for this session.',
        args
      ),
  },
  {
    name: 'amber_judge_demo',
    title: '90-second judge demo',
    description: '90-second judge demo',
    arguments: [],
    build: () =>
      'Run the AMBER judge demo in this order:\n' +
      '1. Call amber_onboarding to see the full manifest and judging pack.\n' +
      '2. Call finance_brief with your ERC-8004 identity to seed financial context.\n' +
      '3. Call memory_demo_pack with your identity to bootstrap memories.\n' +
      '4. Call memory_whoami to see your full persistent context.\n' +
      '5. Call seal_generate to create a wax-seal decree.\n' +
      '6. Open the portrait SVG URL for constellation art.\n' +
      '7. Call amber_judging_pack to see AMBER\'s hackathon evidence packet.',
  },
];

const promptListView = prompts.map((p) => ({
  name: p.name,
  title: p.title,
  description: p.description,
  arguments: p.arguments,
}));

const dispatchPromptsList = (
  reply: FastifyReply,
  body: JsonRpcRequest
): FastifyReply => {
  return reply.code(200).send(rpcOk(body.id, { prompts: promptListView }));
};

const dispatchPromptsGet = (
  reply: FastifyReply,
  body: JsonRpcRequest
): FastifyReply => {
  const params = (body.params ?? {}) as {
    name?: unknown;
    arguments?: Record<string, unknown>;
  };
  const name = typeof params.name === 'string' ? params.name : '';
  const spec = prompts.find((p) => p.name === name);
  if (!spec) {
    return reply.code(200).send(rpcErr(body.id, -32602, `unknown prompt: ${name}`));
  }

  // Coerce all argument values to strings; ignore non-string/unset values.
  const rawArgs = (params.arguments ?? {}) as Record<string, unknown>;
  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawArgs)) {
    if (typeof v === 'string') args[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') args[k] = String(v);
  }

  // Enforce required arguments.
  for (const arg of spec.arguments) {
    if (arg.required && !args[arg.name]) {
      return reply
        .code(200)
        .send(rpcErr(body.id, -32602, `missing required argument: ${arg.name}`));
    }
  }

  const text = spec.build(args);
  return reply.code(200).send(
    rpcOk(body.id, {
      description: spec.description,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text },
        },
      ],
    })
  );
};

// ---------------------------------------------------------------------------
// completion/complete — MCP 2025-06-18 argument autocomplete.
// Supports category and tags arguments for all prompts and tool calls.
// ---------------------------------------------------------------------------

// Must match Prisma/Zod MemoryCategory enum — never suggest invalid values.
const AMBER_CATEGORIES = [
  'preference',
  'fact',
  'event',
  'relationship',
  'task',
  'note',
  'system',
];

const AMBER_TAG_FALLBACK = [
  'onboarding', 'demo-pack', 'wallet', 'portfolio', 'preference',
  'finance', 'goal', 'identity', 'session', 'pinned', 'x-layer',
  'okx', 'dossier', 'lifestyle', 'attestation', 'companion',
];

const dispatchCompletion = async (
  reply: FastifyReply,
  body: JsonRpcRequest
): Promise<FastifyReply> => {
  const params = (body.params ?? {}) as {
    argument?: { name?: string; value?: string };
  };
  const argName = params.argument?.name ?? '';
  const partial = (params.argument?.value ?? '').toLowerCase();

  let values: string[] = [];

  if (argName === 'category') {
    values = AMBER_CATEGORIES.filter((c) => c.startsWith(partial));
  } else if (argName === 'tags' || argName === 'tag') {
    // Try to pull the most common tags from the DB, fall back to static list.
    try {
      const rows = await prismaQuery.$queryRawUnsafe<Array<{ tag: string; ct: bigint }>>(
        `SELECT unnest(tags) AS tag, COUNT(*)::bigint AS ct
           FROM "Memory"
          WHERE "deletedAt" IS NULL
          GROUP BY tag
          ORDER BY ct DESC
          LIMIT 30`
      );
      const dbTags = rows.map((r) => r.tag).filter((t) => t.toLowerCase().includes(partial));
      values = dbTags.length > 0 ? dbTags.slice(0, 10) : AMBER_TAG_FALLBACK.filter((t) => t.includes(partial));
    } catch {
      values = AMBER_TAG_FALLBACK.filter((t) => t.includes(partial));
    }
  } else if (argName === 'query' || argName === 'q') {
    // Suggest common query patterns
    const patterns = [
      'What are my preferences?',
      'What is my portfolio doing?',
      'What wallet facts do I have?',
      'What are my goals?',
      'What changed since yesterday?',
      'Who am I?',
      'What financial events do I have?',
    ];
    values = patterns.filter((p) => p.toLowerCase().includes(partial)).slice(0, 5);
  }

  return reply.code(200).send(
    rpcOk(body.id, {
      completion: {
        values,
        total: values.length,
        hasMore: false,
      },
    })
  );
};

// A2A envelope handler — Onchain OS routes structured messages with a
// `msgType: "a2a-agent-chat"` envelope BEFORE the free-form intent table.
// Any ASP wanting to appear in the priority routing lane MUST accept this
// envelope shape. We answer with a matching envelope + a redirect to the
// canonical MCP tool that satisfies the intent.
//
// Reference: okx/onchainos-skills CLAUDE.md "envelope-based priority routing".
interface A2AEnvelope {
  msgType?: string;
  jobId?: string;
  source?: string;
  event?: string;
  intent?: string;
  identity?: string;
  payload?: Record<string, unknown>;
}

const isA2AEnvelope = (body: unknown): body is A2AEnvelope => {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return b.msgType === 'a2a-agent-chat' || b.source === 'system';
};

const handleA2AEnvelope = (
  envelope: A2AEnvelope,
  reply: FastifyReply
): FastifyReply => {
  // Route the intent to the AMBER tool that best matches. The envelope
  // shape mirrors OKX Onchain OS conventions so downstream orchestrators
  // do not need custom code paths for AMBER.
  const intent = (envelope.intent ?? envelope.event ?? '').toLowerCase();

  const intentToTool: Array<{ pattern: RegExp; tool: string; note: string }> = [
    { pattern: /remember|store|write|persist|save/, tool: 'memory_write', note: 'free up to 100 per identity' },
    { pattern: /recall|search|query|find|retrieve/, tool: 'memory_query', note: 'paid 0.0005 USDT' },
    { pattern: /who\s*am\s*i|whoami|identity|profile/, tool: 'memory_whoami', note: 'free' },
    { pattern: /portfolio|finance|pnl|wallet|holdings/, tool: 'finance_brief', note: 'free' },
    { pattern: /reputation|score|trust|rank/, tool: 'memory_related', note: 'or GET /identity/reputation/:address' },
    { pattern: /goal|habit|streak|track|checkin/, tool: 'memory_habit_check', note: 'free — Lifestyle Companion' },
    { pattern: /template|vertical|asset|resume|creative|prediction/, tool: 'memory_template', note: 'free up to 100 per identity' },
    { pattern: /related|similar|knn|expand/, tool: 'memory_related', note: 'paid 0.0005 USDT — pgvector KNN' },
    { pattern: /pin|permanent|durable|fact/, tool: 'memory_pin', note: 'free' },
    { pattern: /seal|decree|milestone/, tool: 'seal_generate', note: 'paid 0.05 USDT' },
  ];

  const match = intentToTool.find((entry) => entry.pattern.test(intent));
  const tool = match?.tool ?? 'memory_demo_pack';
  const note = match?.note ?? 'run the one-call bootstrap first';

  return reply
    .code(200)
    .header('Content-Type', 'application/json; charset=utf-8')
    .send({
      msgType: 'a2a-agent-chat-response',
      jobId: envelope.jobId ?? null,
      source: 'amber',
      routedTo: {
        protocol: 'mcp',
        method: 'tools/call',
        toolName: tool,
        note,
        endpoint: `${PUBLIC_BASE_URL}/mcp`,
      },
      identity: envelope.identity ?? null,
      supportedIntents: [
        'remember / write',
        'recall / query',
        'whoami / identity',
        'portfolio / finance',
        'reputation / trust',
        'goal / habit / streak',
        'template / vertical',
        'related / similar',
        'pin / permanent',
        'seal / decree',
      ],
      supportedVerticals: ['professional_asset', 'resume', 'creative', 'software', 'prediction'],
      reputationLookup: `${PUBLIC_BASE_URL}/identity/reputation/{address}`,
      generatedAt: new Date().toISOString(),
    });
};

const handlePost = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
  echoProtocolVersion(reply, req);

  if (!checkAccept(req)) {
    return handleError(
      reply,
      400,
      'Accept header must include application/json and text/event-stream',
      AmberErrorCodes.BAD_INPUT
    );
  }

  // A2A envelope priority routing — check BEFORE JSON-RPC parse so structured
  // A2A messages can route without a valid MCP session. This matches OKX
  // Onchain OS's "envelope-based priority routing" specification.
  if (isA2AEnvelope(req.body)) {
    return handleA2AEnvelope(req.body as A2AEnvelope, reply);
  }

  const parsedBody = JsonRpcSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return reply
      .code(200)
      .send(rpcErr(null, -32700, `Parse error: ${parsedBody.error.message}`));
  }
  const body = parsedBody.data as JsonRpcRequest;

  const method = body.method;

  if (method === 'initialize') {
    return handleInitialize(req, reply, body);
  }

  const session = await requireSession(req, reply);
  if (!session) return reply;

  switch (method) {
    case 'notifications/initialized':
      return reply.code(202).send();
    case 'ping':
      return reply.code(200).send(rpcOk(body.id, {}));
    case 'tools/list': {
      // MCP 2025-06-18 addition: `title` is a human-friendly display string
      // separate from the programmatic `name`. We inject titles here rather
      // than duplicating them across every tool definition — one source of
      // truth for how each tool appears in client UIs.
      const toolTitles: Record<string, string> = {
        memory_write: 'Write memory',
        memory_query: 'Recall memory (semantic)',
        memory_bulk_write: 'Bulk write (up to 50)',
        memory_session_context: 'Boot session with recent memory',
        memory_list: 'List memories (chronological)',
        memory_delete: 'Delete a memory',
        memory_get: 'Read a single memory',
        memory_seed_wallet: 'Seed memory from wallet history',
        memory_verify_attestation: 'Verify X Layer attestation',
        seal_generate: 'Generate SEALSCRIBE wax seal',
        portrait_get: 'Get memory constellation portrait',
        memory_share: 'Share memories to another identity',
        memory_consolidate: 'Build memory dossier',
        memory_demo_pack: 'One-call demo bootstrap',
        identity_stats: 'Identity stats',
        amber_onboarding: 'AMBER onboarding manifest',
        portfolio_snapshot: 'OKX X Layer portfolio snapshot',
        memory_analytics: 'Memory analytics',
        memory_graph: 'Memory constellation graph',
        memory_whoami: 'Who am I?',
        memory_diff: 'Session diff (memories since ISO)',
        memory_pin: 'Pin a memory',
        memory_portability_pack: 'Portability pack (export)',
        amber_judging_pack: 'Build X judging pack',
        finance_brief: 'Finance Copilot brief (PnL since last snapshot)',
        lifestyle_remember: 'Lifestyle Companion remember',
        amber_live_stats: 'Live AMBER stats',
        daily_brief: 'Daily memory brief',
        memory_goal_set: 'Set a goal',
        memory_related: 'Related memories (pgvector KNN)',
        memory_habit_check: 'Track a habit (streak)',
        memory_template: 'Write vertical-tagged memory (5 OKX AI verticals)',
        memory_reputation_lookup: 'Look up AMBER Reputation Score (0-100)',
      };
      const toolsWithTitle = tools.map((t) => ({
        ...t,
        title: toolTitles[t.name] ?? t.name,
      }));
      return reply.code(200).send(rpcOk(body.id, { tools: toolsWithTitle }));
    }
    case 'tools/call':
      return dispatchToolsCall(req, reply, body);
    case 'resources/list':
      return dispatchResourcesList(reply, body);
    case 'resources/templates/list':
      return dispatchResourcesTemplatesList(reply, body);
    case 'resources/read':
      return dispatchResourcesRead(reply, body);
    case 'prompts/list':
      return dispatchPromptsList(reply, body);
    case 'prompts/get':
      return dispatchPromptsGet(reply, body);
    case 'completion/complete':
      return dispatchCompletion(reply, body);
    case 'logging/setLevel':
      // MCP 2025-06-18: server accepts log level control; best-effort acknowledgement.
      return reply.code(200).send(rpcOk(body.id, {}));
    case 'elicitation/create':
      // MCP 2025-06-18 elicitation: server can request user input mid-flow.
      // The client MUST send the follow-up as a separate tools/call; we simply
      // acknowledge the schema echo here so client-side elicitation UIs can
      // render our fields. Downstream tool calls then pick up the user's
      // response through their normal arguments.
      return reply.code(200).send(
        rpcOk(body.id, {
          action: 'accept',
          content: {
            // Echo the schema back untouched — AMBER's elicitations are
            // driven by tool parameter shapes already declared in tools/list.
            // A future revision may push this into per-tool preflight hooks.
            note: 'AMBER uses tool-parameter schemas for elicitation. Client should call the target tool with the resolved arguments.',
          },
        })
      );
    case 'notifications/message':
    case 'notifications/resources/updated':
    case 'notifications/tools/list_changed':
    case 'notifications/prompts/list_changed':
      // Client-to-server notifications — acknowledge without error per spec.
      return reply.code(202).send();
    default:
      return reply
        .code(200)
        .send(rpcErr(body.id, -32601, `method not found: ${method}`));
  }
};

export const mcpRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.addHook('preHandler', originAllowlistMiddleware);

  app.post('/', handlePost);

  app.get('/', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(405).send({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'GET /mcp is not implemented (no SSE stream)' },
      data: null,
    });
  });

  app.delete('/', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(405).send({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'DELETE /mcp is not implemented' },
      data: null,
    });
  });

  done();
};
