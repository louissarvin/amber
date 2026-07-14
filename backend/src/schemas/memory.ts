import { z } from 'zod';

// -----------------------------------------------------------------------------
// Wire schemas for the four AMBER memory endpoints.
//
// Same shapes drive REST bodies/queries and MCP tools/call arguments.
// -----------------------------------------------------------------------------

export const IdentityAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, { message: 'identity must be a 0x-prefixed 40-hex address' })
  .transform((s) => s.toLowerCase());

export const CategoryEnum = z.enum([
  'preference',
  'fact',
  'event',
  'relationship',
  'task',
  'note',
  'system',
]);
export type MemoryCategoryValue = z.infer<typeof CategoryEnum>;

export const WriteMemoryRequestSchema = z.object({
  identity: IdentityAddressSchema,
  content: z.string().min(1).max(8192),
  category: CategoryEnum.default('note').optional(),
  tags: z.array(z.string().min(1).max(32)).max(16).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  clientNonce: z.string().min(1).max(128).optional(),
});
export type WriteMemoryRequest = z.infer<typeof WriteMemoryRequestSchema>;

export const BulkWriteRequestSchema = z.object({
  identity: IdentityAddressSchema,
  items: z.array(WriteMemoryRequestSchema.omit({ identity: true })).min(1).max(50),
});
export type BulkWriteRequest = z.infer<typeof BulkWriteRequestSchema>;

export const QueryMemoryRequestSchema = z.object({
  identity: IdentityAddressSchema,
  q: z.string().min(1).max(1024),
  k: z.coerce.number().int().min(1).max(20).default(5),
  category: CategoryEnum.optional(),
  since: z.string().datetime().optional(),
  minRelevance: z.coerce.number().min(0).max(1).default(0.55),
});
export type QueryMemoryRequest = z.infer<typeof QueryMemoryRequestSchema>;

export const SessionContextRequestSchema = z.object({
  identity: IdentityAddressSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SessionContextRequest = z.infer<typeof SessionContextRequestSchema>;

export const ListMemoriesRequestSchema = z.object({
  identity: IdentityAddressSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().datetime().optional(),
  category: CategoryEnum.optional(),
});
export type ListMemoriesRequest = z.infer<typeof ListMemoriesRequestSchema>;

export const DeleteMemoryRequestSchema = z.object({
  identity: IdentityAddressSchema,
  memoryId: z.string().min(1).max(64),
});
export type DeleteMemoryRequest = z.infer<typeof DeleteMemoryRequestSchema>;

export const GetMemoryRequestSchema = z.object({
  identity: IdentityAddressSchema,
  memoryId: z.string().min(1).max(64),
});
export type GetMemoryRequest = z.infer<typeof GetMemoryRequestSchema>;

export const ExportMemoryRequestSchema = z.object({
  identity: IdentityAddressSchema,
  since: z.string().datetime().optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  format: z.enum(['ndjson']).default('ndjson').optional(),
});
export type ExportMemoryRequest = z.infer<typeof ExportMemoryRequestSchema>;

export const ShareMemoriesRequestSchema = z.object({
  identity: IdentityAddressSchema,
  toIdentity: IdentityAddressSchema,
  memoryIds: z.array(z.string().min(1).max(64)).min(1).max(20),
});
export type ShareMemoriesRequest = z.infer<typeof ShareMemoriesRequestSchema>;

export const ConsolidateMemoriesRequestSchema = z.object({
  identity: IdentityAddressSchema,
  limit: z.coerce.number().int().min(5).max(40).default(20).optional(),
});
export type ConsolidateMemoriesRequest = z.infer<typeof ConsolidateMemoriesRequestSchema>;

export const RelatedMemoryRequestSchema = z.object({
  identity: IdentityAddressSchema,
  memoryId: z.string().min(1).max(64),
  k: z.coerce.number().int().min(1).max(20).default(5),
  minRelevance: z.coerce.number().min(0).max(1).default(0.35),
});
export type RelatedMemoryRequest = z.infer<typeof RelatedMemoryRequestSchema>;

// -----------------------------------------------------------------------------
// Public JSON Schemas (surfaced in x402 challenges and MCP tools/list)
// -----------------------------------------------------------------------------

export const WriteMemoryBodySchema = {
  type: 'object',
  required: ['identity', 'content'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    content: { type: 'string', minLength: 1, maxLength: 8192 },
    category: {
      type: 'string',
      enum: ['preference', 'fact', 'event', 'relationship', 'task', 'note', 'system'],
    },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    metadata: { type: 'object' },
    clientNonce: { type: 'string' },
  },
};

export const BulkWriteBodySchema = {
  type: 'object',
  required: ['identity', 'items'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    items: { type: 'array', maxItems: 50, items: { type: 'object' } },
  },
};

export const QueryMemoryQuerySchema = {
  type: 'object',
  required: ['identity', 'q'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    q: { type: 'string', minLength: 1, maxLength: 1024 },
    k: { type: 'integer', minimum: 1, maximum: 20 },
    category: { type: 'string' },
    since: { type: 'string' },
    minRelevance: { type: 'number' },
  },
};

export const SessionContextQuerySchema = {
  type: 'object',
  required: ['identity'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
};

export const ListMemoriesQuerySchema = {
  type: 'object',
  required: ['identity'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    cursor: { type: 'string' },
    category: {
      type: 'string',
      enum: ['preference', 'fact', 'event', 'relationship', 'task', 'note', 'system'],
    },
  },
};

export const DeleteMemoryBodySchema = {
  type: 'object',
  required: ['identity', 'memoryId'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    memoryId: { type: 'string', minLength: 1, maxLength: 64 },
  },
};

export const GetMemoryQuerySchema = {
  type: 'object',
  required: ['identity', 'memoryId'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    memoryId: { type: 'string', minLength: 1, maxLength: 64 },
  },
};

export const ExportMemoryQuerySchema = {
  type: 'object',
  required: ['identity'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    since: { type: 'string', format: 'date-time' },
    cursor: { type: 'string', minLength: 1, maxLength: 64 },
    limit: { type: 'integer', minimum: 1, maximum: 1000 },
    format: { type: 'string', enum: ['ndjson'] },
  },
};

export const ShareMemoriesBodySchema = {
  type: 'object',
  required: ['identity', 'toIdentity', 'memoryIds'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    toIdentity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    memoryIds: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
};

export const ConsolidateMemoriesBodySchema = {
  type: 'object',
  required: ['identity'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    limit: { type: 'integer', minimum: 5, maximum: 40 },
  },
};

export const RelatedMemoryBodySchema = {
  type: 'object',
  required: ['identity', 'memoryId'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    memoryId: { type: 'string', minLength: 1, maxLength: 64 },
    k: { type: 'integer', minimum: 1, maximum: 20 },
    minRelevance: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const DemoPackRequestSchema = z.object({
  identity: IdentityAddressSchema,
  preference: z.string().min(1).max(512).optional(),
});
export type DemoPackRequest = z.infer<typeof DemoPackRequestSchema>;

export const DemoPackBodySchema = {
  type: 'object',
  required: ['identity'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    preference: { type: 'string', minLength: 1, maxLength: 512 },
  },
};

export const WhoAmIRequestSchema = z.object({
  identity: IdentityAddressSchema,
});
export type WhoAmIRequest = z.infer<typeof WhoAmIRequestSchema>;

export const WhoAmIBodySchema = {
  type: 'object',
  required: ['identity'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
  },
};

export const SessionDiffRequestSchema = z.object({
  identity: IdentityAddressSchema,
  since: z.string().datetime(),
});
export type SessionDiffRequest = z.infer<typeof SessionDiffRequestSchema>;

export const SessionDiffBodySchema = {
  type: 'object',
  required: ['identity', 'since'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    since: { type: 'string', format: 'date-time' },
  },
};

export const PinMemoryRequestSchema = z.object({
  identity: IdentityAddressSchema,
  memoryId: z.string().min(1).max(64),
  pinned: z.boolean().default(true),
});
export type PinMemoryRequest = z.infer<typeof PinMemoryRequestSchema>;

export const PinMemoryBodySchema = {
  type: 'object',
  required: ['identity', 'memoryId'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    memoryId: { type: 'string', minLength: 1, maxLength: 64 },
    pinned: { type: 'boolean' },
  },
};

export const PortabilityPackRequestSchema = z.object({
  identity: IdentityAddressSchema,
  limit: z.coerce.number().int().min(1).max(100).default(100),
  since: z.string().datetime().optional(),
});
export type PortabilityPackRequest = z.infer<typeof PortabilityPackRequestSchema>;

export const PortabilityPackBodySchema = {
  type: 'object',
  required: ['identity'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    since: { type: 'string', format: 'date-time' },
  },
};
