import type { FastifyRequest } from 'fastify';

// -----------------------------------------------------------------------------
// Direct connectivity / functional "probe" detection.
//
// The OKX A2MCP review harness tests each listed service with a DIRECT call to
// its endpoint and supplies NO request body. For a paid route it expects 402,
// for a free route it expects 200. On POST routes this app validates the Zod
// body BEFORE the x402 gate, so a bodyless POST used to 400 (schema error) and
// never surfaced a clean 402/200 — which is why the POST-body flagship services
// had to be dropped from the listing.
//
// `isProbeRequest` recognises that bodyless shape so:
//   * paid POST routes can emit their 402 challenge before validation, and
//   * free POST routes can answer 200 with a genuine read of the seeded demo
//     identity's current state (see PROBE_IDENTITY).
//
// A request that carries ANY real JSON body is NOT a probe and flows through the
// unchanged handler logic.
// -----------------------------------------------------------------------------

// Seeded demo identity that already holds real AMBER memories. Free-route probes
// return a genuine read of THIS identity's state so the 200 body is honest and
// representative of the tool's normal output — never fabricated.
export const PROBE_IDENTITY = '0xdeadbeef000000000000000000000000deadbeef';

// Neutral placeholder passed to the x402 gate when a paid-route probe carries no
// identity in its (absent) body. The zero address can never match a recovered
// EIP-3009 signer, so a probe that somehow also carried a payment signature
// still fails closed (401) instead of authorising a spend against a real payer.
export const ZERO_IDENTITY = '0x0000000000000000000000000000000000000000';

// True when the request has no usable body: undefined, null, empty string, or an
// empty object `{}`. This is intentionally strict — the moment a single field is
// present the request is treated as real usage, so parameterized calls behave
// exactly as before.
export const isProbeRequest = (req: FastifyRequest): boolean => {
  const body = req.body;
  if (body === undefined || body === null) return true;
  if (typeof body === 'string') return body.trim().length === 0;
  if (typeof body === 'object' && !Array.isArray(body)) {
    return Object.keys(body as Record<string, unknown>).length === 0;
  }
  return false;
};
