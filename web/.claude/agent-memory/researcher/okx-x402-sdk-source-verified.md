---
name: okx-x402-sdk-source-verified
description: Exact bytes of the OKX x402 SDK "standard" 402 response, verified from npm source, and the confirmed AMBER deviation that failed OKX x402 standard-validation.
metadata:
  type: project
---

OKX A2MCP x402 seller-side 402, verified from npm SDK source (`@okxweb3/x402-core@0.1.0`,
`@okxweb3/x402-express@0.1.1`, `@okxweb3/x402-fastify@0.1.1`, unpacked + read via sourcemap
`sourcesContent`). A `@okxweb3/x402-fastify` package EXISTS (relevant since AMBER backend is
Fastify).

**SDK "standard" unpaid 402 (non-browser):** status `402`; headers EXACTLY
`{Content-Type: application/json, PAYMENT-REQUIRED: <base64>}` (no WWW-Authenticate); body
default `{}`. PAYMENT-REQUIRED = `base64(JSON.stringify({x402Version:2, error:"Payment
required", resource:{url,description,mimeType}, accepts:[{scheme,network,amount,asset,payTo,
maxTimeoutSeconds,extra}]}))`. Inbound payment header read: `PAYMENT-SIGNATURE` or
`X-PAYMENT`. The SDK **client reads the challenge from the PAYMENT-REQUIRED header ONLY**
(`x402HTTPClient.ts:89-98`), never the body — so the 402 body is irrelevant. The middleware
emits the 402 in an `onRequest` hook BEFORE any body/query validation, on route match alone.
`PaymentRequiredSchema` (Zod) is non-strict: extra `resource.method`/`outputSchema` are
STRIPPED, not rejected.

**Confirmed AMBER failure (2026-07-26 rejection "not passed x402 standard validation"):**
NOT a challenge-content problem (our header passes the SDK's own schema). The defect is that
AMBER's paid endpoints never RETURN a 402 to OKX's bodyless direct probe: `/memory/query`
and `/memory/session-context` are GET-only routes whose handlers `safeParse(request.query)`
BEFORE the x402 gate, so `POST /memory/query` → 404 (no POST route) and bare
`GET /memory/query` (no params) → 400. OKX's harness probes bodyless (documented self-check
is `curl -i -X POST`; AMBER's own `src/lib/probe/probe.ts:5-16` records this) so it sees
404/400, never 402. POST paid routes were already fixed via `isProbeRequest`; the two paid
GET routes were missed.

**Fix chosen:** replicate/gate in existing code (return a standard 402 for unpaid bodyless
probes before validation + register the paid GET routes for POST) rather than wiring the SDK
middleware (which would swap the whole verify+settle path onto OKXFacilitatorClient — high
risk near deadline). Full field-level spec appended to
`/Users/macbookair/Documents/amber/backend/memory/OKX_DOCS_ALIGNMENT.md` section
"X402 STANDARD-VALIDATION REJECTION FIX (2026-07-26)".

Related: [[okx-a2mcp-review-rejection-root-cause]] (earlier functional-fit analysis; that
`period`-scheme/functional-fit line was for the 3 GENERIC rejections, superseded here for the
SPECIFIC x402-validation one).

**Why/How to apply:** For any "OKX x402 standard validation" rejection, the first check is
whether an UNPAID, BODYLESS, POST-or-GET direct hit on the registered URL returns 402 (not
404/400/200). Content/field alignment is secondary — OKX validates the PAYMENT-REQUIRED
header, not the body. Verify SDK behavior from npm source, never from training data.
