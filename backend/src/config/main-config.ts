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
