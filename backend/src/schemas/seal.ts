import { z } from 'zod';
import { IdentityAddressSchema } from './memory.ts';

// SEALSCRIBE-lite + wallet-seed wire schemas (REST + MCP).

export const SigilStyleSchema = z.enum(['amber', 'onyx', 'cream']);

export const GenerateSealRequestSchema = z.object({
  identity: IdentityAddressSchema,
  subject: z.string().min(1).max(120),
  decreeText: z.string().min(1).max(2000),
  sigilStyle: SigilStyleSchema.default('amber').optional(),
});
export type GenerateSealRequest = z.infer<typeof GenerateSealRequestSchema>;

export const GenerateSealBodySchema = {
  type: 'object',
  required: ['identity', 'subject', 'decreeText'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    subject: { type: 'string', minLength: 1, maxLength: 120 },
    decreeText: { type: 'string', minLength: 1, maxLength: 2000 },
    sigilStyle: { type: 'string', enum: ['amber', 'onyx', 'cream'] },
  },
};

export const WalletSeedRequestSchema = z.object({
  identity: IdentityAddressSchema,
  lookbackBlocks: z.coerce.number().int().min(0).max(16).default(0).optional(),
});
export type WalletSeedRequest = z.infer<typeof WalletSeedRequestSchema>;

export const WalletSeedBodySchema = {
  type: 'object',
  required: ['identity'],
  properties: {
    identity: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    lookbackBlocks: { type: 'integer', minimum: 0, maximum: 16 },
  },
};

export const VerifyAttestationRequestSchema = z.object({
  memoryId: z.string().min(1).max(64),
});
export type VerifyAttestationRequest = z.infer<typeof VerifyAttestationRequestSchema>;

export const VerifyAttestationBodySchema = {
  type: 'object',
  required: ['memoryId'],
  properties: {
    memoryId: { type: 'string', minLength: 1, maxLength: 64 },
  },
};
