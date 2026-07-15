import { writeOne } from './memoryWriter.ts';
import { setMemoryPinned } from './memoryWhoami.ts';

// -----------------------------------------------------------------------------
// Shared memory_template write path.
//
// The MCP `memory_template` tool and the demo-seeding routine MUST write
// through the exact same logic so a seeded demo identity is indistinguishable
// from an organically-populated one. This module owns the single source of
// truth for the 5 OKX AI vertical → (category, tags, recall) mapping and the
// tag/nonce construction. The MCP handler keeps its own payment/x402 gating and
// then delegates the actual write here.
// -----------------------------------------------------------------------------

export type TemplateCategory = 'preference' | 'fact' | 'note';

export interface TemplateVerticalConfig {
  category: TemplateCategory;
  tags: string[];
  recall: string;
  nextTool: string;
}

// Vertical → config. Matches the 5 OKX AI ASP categories. The vertical tags
// (asset-creation, resume, creative, software, prediction-market) are the exact
// set scored by the reputation "breadth" axis, so writing one memory per
// vertical covers all 5.
export const TEMPLATE_VERTICALS: Record<string, TemplateVerticalConfig> = {
  professional_asset: {
    category: 'fact',
    tags: ['okx-ai', 'asset-creation', 'professional', 'template'],
    recall: 'templates decks presentations reports style-guide brand',
    nextTool: 'memory_query with q="my presentation style and template preferences"',
  },
  resume: {
    category: 'fact',
    tags: ['okx-ai', 'resume', 'career', 'ats', 'professional'],
    recall: 'resume career history skills achievements target-role industry',
    nextTool: 'memory_query with q="my career history and target roles"',
  },
  creative: {
    category: 'preference',
    tags: ['okx-ai', 'creative', 'brand', 'design', 'nft'],
    recall: 'brand palette voice creative design NFT lineage style',
    nextTool: 'memory_query with q="my brand palette voice and creative preferences"',
  },
  software: {
    category: 'note',
    tags: ['okx-ai', 'software', 'devops', 'schema', 'code'],
    recall: 'codebase schema deployment ML infrastructure agent-training',
    nextTool: 'memory_related on this memoryId to expand technical context',
  },
  prediction: {
    category: 'fact',
    tags: ['okx-ai', 'prediction-market', 'trading', 'conviction', 'pnl'],
    recall: 'prediction market conviction PnL risk-tolerance position-sizing',
    nextTool: 'finance_brief to compare prediction PnL against portfolio PnL',
  },
};

export const TEMPLATE_VERTICAL_KEYS = Object.keys(TEMPLATE_VERTICALS);

export interface WriteVerticalInput {
  identityAddress: string; // lowercased 0x address
  vertical: string;
  content: string;
  subject?: string;
  pin?: boolean;
  paymentMode: 'free' | 'paid';
  // Optional override so callers that need per-item idempotency (e.g. a seed
  // that writes many distinct memories per vertical in one day) can supply a
  // unique nonce. When omitted a daily content-derived nonce is used, matching
  // the original MCP tool behaviour.
  clientNonce?: string;
}

export interface WriteVerticalResult {
  memoryId: string;
  vertical: string;
  subject: string | null;
  tags: string[];
  category: TemplateCategory;
  pinned: boolean;
  replay: boolean;
  freeRemaining: number;
  crossVerticalRecall: string;
  nextTool: string;
}

/**
 * Build the final tag list for a template write. Exported for callers that need
 * the tags without performing a write.
 */
export const buildTemplateTags = (vertical: string, subject?: string): string[] => {
  const config = TEMPLATE_VERTICALS[vertical];
  if (!config) throw new Error(`unknown vertical: ${vertical}`);
  const finalTags = [...config.tags];
  const trimmed = subject?.trim();
  if (trimmed) {
    const subjectTag = trimmed.slice(0, 32).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    if (subjectTag) finalTags.push(`subject:${subjectTag}`);
  }
  return finalTags;
};

/**
 * Write a vertical-tagged memory through the real writeOne path and optionally
 * pin it. This is the single shared implementation used by both the MCP
 * `memory_template` tool (after its payment gating) and the demo seeder.
 */
export const writeVerticalMemory = async (
  input: WriteVerticalInput
): Promise<WriteVerticalResult> => {
  const config = TEMPLATE_VERTICALS[input.vertical];
  if (!config) {
    throw Object.assign(new Error(`vertical must be one of: ${TEMPLATE_VERTICAL_KEYS.join(', ')}`), {
      code: 'BAD_INPUT',
    });
  }

  const identityAddr = input.identityAddress.toLowerCase();
  const content = input.content.trim();
  const subject = input.subject?.trim() || '';
  const finalTags = buildTemplateTags(input.vertical, subject);

  // Daily content-derived nonce keeps same-day re-runs idempotent (writeOne
  // returns the existing row as a replay). Callers may override.
  const day = new Date().toISOString().slice(0, 10);
  const nonce =
    input.clientNonce ??
    `template:${input.vertical}:${identityAddr}:${Buffer.from(content).toString('base64url').slice(0, 20)}:${day}`;

  const written = await writeOne({
    identityAddress: identityAddr,
    content: subject ? `[${subject}] ${content}` : content,
    category: config.category,
    tags: finalTags,
    metadata: {
      source: 'memory_template',
      vertical: input.vertical,
      ...(subject ? { subject } : {}),
    },
    clientNonce: nonce,
    paymentMode: input.paymentMode,
  });

  let pinned = false;
  if (input.pin) {
    try {
      await setMemoryPinned(identityAddr, written.memoryId, true);
      pinned = true;
    } catch (err) {
      // Non-fatal: pinning is a deliberateness signal, not a correctness one.
      console.warn('[memoryTemplate] pin failed:', (err as Error).message);
    }
  }

  return {
    memoryId: written.memoryId,
    vertical: input.vertical,
    subject: subject || null,
    tags: finalTags,
    category: config.category,
    pinned,
    replay: written.replay,
    freeRemaining: written.freeRemaining,
    crossVerticalRecall: config.recall,
    nextTool: config.nextTool,
  };
};
