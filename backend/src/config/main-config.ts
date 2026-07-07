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
