import crypto from 'node:crypto';
import { prismaQuery } from '../lib/prisma.ts';
import { getOrCreateIdentity } from './identity.ts';
import { pendingAttestationRef, type AttestationRef } from './attestationRef.ts';
import { PUBLIC_BASE_URL } from '../config/main-config.ts';
import { UNTRUSTED_MEMORY_FRAME } from '../lib/memorySanitize.ts';

// -----------------------------------------------------------------------------
// Portability Pack — bounded JSON export for MCP clients.
//
// REST already exposes a paid NDJSON stream. This MCP-native pack is smaller
// and judge/demo friendly: it proves "portable memory" without making agents
// handle a streaming endpoint.
// -----------------------------------------------------------------------------

interface PortabilityMemory {
  memoryId: string;
  content: string;
  category: string;
  tags: string[];
  metadata: unknown;
  createdAt: string;
  attestation: AttestationRef;
}

export interface PortabilityPack {
  schema: 'amber.portability.v1';
  identity: string;
  generatedAt: string;
  safetyFrame: string;
  count: number;
  limit: number;
  since: string | null;
  memories: PortabilityMemory[];
  sha256: string;
  importHint: {
    mcpTool: 'memory_bulk_write';
    endpoint: string;
    note: string;
  };
}
