import { redis } from '../lib/redis.ts';
import { RATE_LIMIT_PER_MIN } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// Rate limiter — fixed 60-second window per (identity, endpoint) pair.
//
// Implementation: INCR + EXPIRE (only set TTL on the first INCR to preserve
// the sliding-window boundary until the natural expiry).
//
// Returns:
//   { allowed: true }  when under the cap
//   { allowed: false, retryAfterSeconds } when over the cap
//
// Fail-open on Redis errors: rate limiting is a nice-to-have; the payment
// gate is the real spend defense. But the failure is logged.
// -----------------------------------------------------------------------------

export interface RateResult {
  allowed: boolean;
  retryAfterSeconds: number;
  count: number;
  limit: number;
}

export const incrementRate = async (
  identityAddressLower: string,
  endpoint: string,
  limitPerMinute: number = RATE_LIMIT_PER_MIN
): Promise<RateResult> => {
  const key = `rate:${identityAddressLower}:${endpoint}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }
    if (count > limitPerMinute) {
      const ttl = await redis.ttl(key);
      return {
        allowed: false,
        retryAfterSeconds: ttl > 0 ? ttl : 60,
        count,
        limit: limitPerMinute,
      };
    }
    return { allowed: true, retryAfterSeconds: 0, count, limit: limitPerMinute };
  } catch (err) {
    console.warn('[rate] redis INCR failed, failing open:', (err as Error).message);
    return { allowed: true, retryAfterSeconds: 0, count: 0, limit: limitPerMinute };
  }
};
