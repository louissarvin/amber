/**
 * Centralized configuration for the application
 * All commonly used environment variables should be defined here
 */

import path from 'node:path';

// Process start timestamp — used by discovery/health surfaces to report uptime.
export const PROCESS_START_UNIX_MS: number = Date.now();

// -----------------------------------------------------------------------------
// Base required env (starter defaults)
// -----------------------------------------------------------------------------

const baseRequiredEnvVars: string[] = ['DATABASE_URL', 'JWT_SECRET'];

for (const envVar of baseRequiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// App Configuration
export const APP_PORT: number = Number(process.env.APP_PORT) || 3700;
export const NODE_ENV: string = process.env.NODE_ENV || 'development';
export const IS_DEV: boolean = NODE_ENV === 'development';
export const IS_PROD: boolean = NODE_ENV === 'production';

// Database
export const DATABASE_URL: string = process.env.DATABASE_URL as string;

// Authentication
export const JWT_SECRET: string = process.env.JWT_SECRET as string;
export const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '7d';
// Admin metrics / Memory Report — Bearer token. Defaults to JWT_SECRET so
// existing deploys keep working without a new secret; set ADMIN_API_TOKEN
// explicitly in production.
export const ADMIN_API_TOKEN: string =
  (process.env.ADMIN_API_TOKEN as string) || JWT_SECRET;

// Error Log Configuration
export const ERROR_LOG_MAX_RECORDS: number = 10000;
export const ERROR_LOG_CLEANUP_INTERVAL: string = '0 * * * *'; // Every hour

// -----------------------------------------------------------------------------
// AMBER extensions
// -----------------------------------------------------------------------------

export type SignerModeType = 'tee' | 'self';

// XLayer / chain
export const XLAYER_RPC: string = (process.env.XLAYER_RPC as string) || '';
export const XLAYER_CHAIN_ID: number = Number(process.env.XLAYER_CHAIN_ID) || 196;

// USDT on XLayer. VERIFIED: 0x1e4a5963abfd975d8c9021ce480b42188849d41d,
// symbol=USDT, decimals=6. The live EIP-712 domain is re-read from chain at
// boot by initUsdtDomain(); these are the fallbacks used before that resolves.
export const USDT_XLAYER_ADDRESS: string = (
  process.env.USDT_XLAYER_ADDRESS || '0x1e4a5963abfd975d8c9021ce480b42188849d41d'
).toLowerCase();
export const USDT_EIP712_NAME: string = process.env.USDT_EIP712_NAME || 'USD₮0';
export const USDT_EIP712_VERSION: string = process.env.USDT_EIP712_VERSION || '1';
export const USDT_SYMBOL: string = process.env.USDT_SYMBOL || 'USD₮0';
export const USDT_DECIMALS: number = Number(process.env.USDT_DECIMALS) || 6;

// ERC-8004 identity registry (keyed by agentId / tokenId, not address).
export const ERC8004_REGISTRY_ADDRESS: string = (
  process.env.ERC8004_REGISTRY_ADDRESS || '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432'
).toLowerCase();
export const REQUIRE_ERC8004_REGISTERED: boolean = process.env.REQUIRE_ERC8004_REGISTERED === 'true';

// AMBER attestation contract on XLayer.
export const ATTESTATION_CONTRACT_ADDRESS: string = (
  process.env.ATTESTATION_CONTRACT_ADDRESS || ''
).toLowerCase();

// ASP wallet: payTo target for the x402 exact scheme (also the OKX Agentic
// Wallet address when SIGNER_MODE=tee).
export const ASP_WALLET_ADDRESS: string = (process.env.ASP_WALLET_ADDRESS || '').toLowerCase();

// Canonical Permit2 contract, advertised in x402 challenges for the exact scheme.
export const PERMIT2_ADDRESS: string = (
  process.env.PERMIT2_ADDRESS || '0x000000000022d473030f116ddee9f6b43ac78ba3'
).toLowerCase();

// Whether the payment settler broadcasts settlement transactions on-chain.
// Requires ASP_PRIVATE_KEY to be set.
export const SETTLE_ON_CHAIN: boolean = process.env.SETTLE_ON_CHAIN === 'true';

// Signer mode + credentials.
export const SIGNER_MODE: SignerModeType = (process.env.SIGNER_MODE as SignerModeType) || 'tee';
export const ASP_PRIVATE_KEY: string | undefined = process.env.ASP_PRIVATE_KEY; // SIGNER_MODE=self

// OKX Agentic Wallet (TEE signer path).
export const OKX_API_KEY: string | undefined = process.env.OKX_API_KEY;
export const OKX_SECRET_KEY: string | undefined = process.env.OKX_SECRET_KEY;
export const OKX_PASSPHRASE: string | undefined = process.env.OKX_PASSPHRASE;
export const OKX_WALLET_ADDRESS: string | undefined = process.env.OKX_WALLET_ADDRESS?.toLowerCase();

// OpenAI (embeddings).
export const OPENAI_API_KEY: string = (process.env.OPENAI_API_KEY as string) || '';
export const OPENAI_EMBEDDING_MODEL: string =
  process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
export const OPENAI_EMBEDDING_DIMENSIONS: number =
  Number(process.env.OPENAI_EMBEDDING_DIMENSIONS) || 1024;

// Redis (Upstash TLS or local).
export const REDIS_URL: string = (process.env.REDIS_URL as string) || '';

// Public base URL of this backend (x402 challenge resource.url, MCP absolute URLs).
export const PUBLIC_BASE_URL: string = (process.env.PUBLIC_BASE_URL as string) || '';

// MCP transport.
export const MCP_ALLOWED_ORIGINS: string[] = (
  process.env.MCP_ALLOWED_ORIGINS ||
  'https://claude.ai,https://chatgpt.com,https://cursor.sh,https://openclaw.dev,https://www.okx.ai,https://okx.ai,https://okx.com,https://oklink.com,https://web3.okx.com'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const MCP_PROTOCOL_VERSION: string = process.env.MCP_PROTOCOL_VERSION || '2025-06-18';
export const MCP_ALLOW_ANY_ORIGIN: boolean = process.env.MCP_ALLOW_ANY_ORIGIN === 'true'; // dev only

// Quotas + pricing (all values in atomic 6-decimal USDT).
export const FREE_TIER_WRITES_PER_IDENTITY: number =
  Number(process.env.FREE_TIER_WRITES_PER_IDENTITY) || 100;
export const PRICE_WRITE_ATOMIC: number = Number(process.env.PRICE_WRITE_ATOMIC) || 1000; // 0.001 USDT
export const PRICE_QUERY_ATOMIC: number = Number(process.env.PRICE_QUERY_ATOMIC) || 500; // 0.0005 USDT
export const PRICE_BULK_ATOMIC: number = Number(process.env.PRICE_BULK_ATOMIC) || 0; // free
export const PRICE_SESSION_CONTEXT_ATOMIC: number =
  Number(process.env.PRICE_SESSION_CONTEXT_ATOMIC) || 200; // 0.0002 USDT
export const PRICE_SEAL_ATOMIC: number = Number(process.env.PRICE_SEAL_ATOMIC) || 50000; // 0.05 USDT
export const PRICE_EXPORT_ATOMIC: number = Number(process.env.PRICE_EXPORT_ATOMIC) || 1000; // 0.001 USDT

// Subscription (x402 period scheme) budget ceiling in atomic USDT.
export const SUBSCRIPTION_MAX_BUDGET_ATOMIC: number =
  Number(process.env.SUBSCRIPTION_MAX_BUDGET_ATOMIC) || 100000000; // 100 USDT

// Rate limits (per identity per endpoint per minute).
export const RATE_LIMIT_PER_MIN: number = Number(process.env.RATE_LIMIT_PER_MIN) || 60;
export const RATE_LIMIT_BULK_PER_MIN: number = Number(process.env.RATE_LIMIT_BULK_PER_MIN) || 5;

// Attestation batcher.
export const ATTESTATION_BATCH_SIZE: number = Number(process.env.ATTESTATION_BATCH_SIZE) || 32;
export const ATTESTATION_INTERVAL_SECONDS: number =
  Number(process.env.ATTESTATION_INTERVAL_SECONDS) || 15;
export const ATTESTATION_MAX_RETRIES: number = Number(process.env.ATTESTATION_MAX_RETRIES) || 3;

// Local asset directory (SEALSCRIBE svgs, portrait renders).
export const ASSETS_DIR: string = process.env.ASSETS_DIR || path.join(process.cwd(), 'assets');

// PAYMENT_DEBUG=true logs the raw base64 payment header for diagnostics.
export const PAYMENT_DEBUG: boolean = process.env.PAYMENT_DEBUG === 'true';

// x402 `period` (subscription) scheme is a stretch surface, off by default.
export const X402_ENABLE_PERIOD: boolean = process.env.X402_ENABLE_PERIOD === 'true';
// HMAC key for period appAccessToken values. Falls back to JWT_SECRET.
export const APP_ACCESS_HMAC_SECRET: string =
  process.env.APP_ACCESS_HMAC_SECRET || JWT_SECRET;

// Optional metadata advertised on discovery surfaces.
export const ASP_CONTACT_EMAIL: string | undefined = process.env.ASP_CONTACT_EMAIL;
export const ASP_AGENT_ID: string | null = process.env.ASP_AGENT_ID || null;

