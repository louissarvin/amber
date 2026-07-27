import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { paymentMiddleware, x402ResourceServer } from '@okxweb3/x402-fastify';
import { ExactEvmScheme } from '@okxweb3/x402-evm/exact/server';
import { OKXFacilitatorClient } from '@okxweb3/x402-core';
import { closeRedis } from './helpers.ts';

// -----------------------------------------------------------------------------
// Official OKX Payment SDK wiring — the 3 paid memory routes.
//
// We register the SDK payment middleware EXACTLY the way index.ts does (root
// instance, verb-less full-path route keys, real ExactEvmScheme on eip155:196),
// but with a MOCK facilitator: the real OKXFacilitatorClient calls
// https://web3.okx.com and this machine is behind Cloudflare WARP (403). The
// mock's getSupported() advertises exact@eip155:196 (required before the SDK can
// build a 402); verify()/settle() are controllable so a "paid" request passes.
//
// The suite runs against a REAL HTTP server on an EPHEMERAL port (0 — never
// 3700). This exercises the same request lifecycle as the VPS and avoids a
// light-my-request/inject incompatibility with the SDK adapter's async-hook
// send pattern.
//
// Proves:
//   * an UNPAID request to each of /memory/query, /memory/session-context,
//     /memory/write returns a standard 402 with a decodable PAYMENT-REQUIRED
//     header (x402Version 2; accepts[0] = exact / eip155:196 / payTo / amount /
//     asset USD₮0 / flat extra {name:"USD₮0",version:"1"}) for ANY method
//     (verb-less route keys → the OKX bodyless self-check probe works).
//   * a request whose facilitator.verify() MOCK returns valid passes THROUGH the
//     payment hook to the business handler (200).
//   * a NON-matching route (/memory/list) is untouched by the middleware.
// -----------------------------------------------------------------------------

const PAY_TO = '0x000000000000000000000000000000000000dead';
const USDT0 = '0x779ded0c9e1022225f8e0630b35a9b54be713736';

let verifyCalls = 0;
let verifyValid = false;
const mockFacilitator = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getSupported(): Promise<any> {
    return {
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:196' }],
      extensions: [],
      signers: {},
    };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async verify(): Promise<any> {
    verifyCalls += 1;
    return verifyValid
      ? { isValid: true, payer: PAY_TO }
      : { isValid: false, invalidReason: 'mock_unpaid' };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async settle(): Promise<any> {
    return { success: true, status: 'success', transaction: '0xmocktx', network: 'eip155:196', payer: PAY_TO };
  },
};

let app: FastifyInstance;
let baseUrl = '';
let handlerHits = 0;

beforeAll(async () => {
  app = Fastify();

  // Mirror index.ts: the paid routes live in an ENCAPSULATED plugin registered
  // under the /memory prefix, registered BEFORE paymentMiddleware runs. This is
  // the real production risk area — proving the root-level onRequest hook the
  // SDK installs still gates routes in a child plugin registered earlier in
  // source order. Stand-in handlers (the real ones hit Postgres/Redis).
  const memoryPlugin = (
    instance: FastifyInstance,
    _opts: unknown,
    done: () => void
  ): void => {
    instance.get('/query', async () => {
      handlerHits += 1;
      return { success: true, error: null, data: { ok: true } };
    });
    instance.post('/query', async () => {
      handlerHits += 1;
      return { success: true, error: null, data: { ok: true } };
    });
    instance.get('/session-context', async () => ({ success: true, error: null, data: {} }));
    instance.post('/write', async () => ({ success: true, error: null, data: {} }));
    // A route intentionally NOT in the payment config — must fall through.
    instance.get('/list', async () => ({ success: true, error: null, data: [] }));
    done();
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.register(memoryPlugin as any, { prefix: '/memory' });

  const server = new x402ResourceServer(mockFacilitator).register(
    'eip155:196',
    new ExactEvmScheme()
  );

  paymentMiddleware(
    app,
    {
      '/memory/query': {
        accepts: { scheme: 'exact', network: 'eip155:196', payTo: PAY_TO, price: '$0.0005' },
        description: 'Memory recall',
        mimeType: 'application/json',
      },
      '/memory/session-context': {
        accepts: { scheme: 'exact', network: 'eip155:196', payTo: PAY_TO, price: '$0.0002' },
        description: 'Session context',
        mimeType: 'application/json',
      },
      '/memory/write': {
        accepts: { scheme: 'exact', network: 'eip155:196', payTo: PAY_TO, price: '$0.001' },
        description: 'Memory write',
        mimeType: 'application/json',
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server as any
  );

  // Ephemeral port (0). NEVER binds 3700.
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (app) await app.close();
  await closeRedis();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const decodePaymentRequired = (header: string): any =>
  JSON.parse(Buffer.from(header, 'base64').toString('utf8'));

describe('unpaid probe → standard 402 (verb-less route keys)', () => {
  const cases = [
    { method: 'POST', url: '/memory/query', amount: '500' },
    { method: 'GET', url: '/memory/query', amount: '500' },
    { method: 'GET', url: '/memory/session-context', amount: '200' },
    { method: 'POST', url: '/memory/write', amount: '1000' },
  ] as const;

  for (const c of cases) {
    test(`${c.method} ${c.url} (no payment) → 402 + PAYMENT-REQUIRED`, async () => {
      const res = await fetch(`${baseUrl}${c.url}`, { method: c.method });
      expect(res.status).toBe(402);
      const header = res.headers.get('payment-required');
      expect(header).toBeTruthy();

      const challenge = decodePaymentRequired(header!);
      expect(challenge.x402Version).toBe(2);
      const accept = challenge.accepts[0];
      expect(accept.scheme).toBe('exact');
      expect(accept.network).toBe('eip155:196');
      expect(accept.payTo.toLowerCase()).toBe(PAY_TO.toLowerCase());
      expect(accept.amount).toBe(c.amount);
      expect(accept.asset.toLowerCase()).toBe(USDT0);
      // Flat extra — name is the Tugrik sign U+20AE, version "1".
      expect(accept.extra).toMatchObject({ name: 'USD₮0', version: '1' });
      expect(accept.extra.name.charCodeAt(3)).toBe(0x20ae);
    });
  }
});

describe('valid payment passes through to the handler', () => {
  test('GET /memory/query with a verify-valid payment → handler runs (200)', async () => {
    // 1. Probe unpaid to obtain the exact server requirement.
    const probe = await fetch(`${baseUrl}/memory/query`, { method: 'GET' });
    expect(probe.status).toBe(402);
    const challenge = decodePaymentRequired(probe.headers.get('payment-required')!);
    const accepted = challenge.accepts[0];

    // 2. Build a payment payload whose `accepted` mirrors the server requirement
    //    so findMatchingRequirements() matches; verify() is mocked, so the
    //    payload's cryptographic contents are irrelevant here.
    const payload = {
      x402Version: 2,
      scheme: 'exact',
      network: 'eip155:196',
      accepted,
      payload: { signature: '0x', authorization: {} },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString('base64');

    verifyValid = true;
    const before = handlerHits;
    const callsBefore = verifyCalls;
    const res = await fetch(`${baseUrl}/memory/query`, {
      method: 'GET',
      headers: { 'payment-signature': header },
    });
    verifyValid = false;

    expect(verifyCalls).toBe(callsBefore + 1); // facilitator.verify() was invoked
    expect(res.status).toBe(200);
    expect(handlerHits).toBe(before + 1);
  });
});

describe('non-matching route falls through untouched', () => {
  test('GET /memory/list (not in payment config) → 200, never 402', async () => {
    const res = await fetch(`${baseUrl}/memory/list`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.headers.get('payment-required')).toBeNull();
  });
});

describe('production wiring smoke — real OKXFacilitatorClient (network-free)', () => {
  // Mirrors index.ts's construction. NOTE: paymentMiddleware fires
  // getSupported() EAGERLY at registration time (initPromise =
  // httpServer.initialize()), not on first request — so with the real (fake-cred)
  // client we pass syncFacilitatorOnStart=false here to avoid a live network call
  // (this Mac is behind Cloudflare WARP). Production keeps the default true so the
  // facilitator supported-kinds map is populated at boot on the VPS.
  test('OKXFacilitatorClient + x402ResourceServer.register + paymentMiddleware construct without throwing', async () => {
    const facilitator = new OKXFacilitatorClient({
      apiKey: 'test-key',
      secretKey: 'test-secret',
      passphrase: 'test-pass',
    });
    const server = new x402ResourceServer(facilitator).register(
      'eip155:196',
      new ExactEvmScheme()
    );
    const smokeApp = Fastify();
    smokeApp.get('/memory/query', async () => ({ ok: true }));
    expect(() =>
      paymentMiddleware(
        smokeApp,
        {
          '/memory/query': {
            accepts: { scheme: 'exact', network: 'eip155:196', payTo: PAY_TO, price: '$0.0005' },
            description: 'Memory recall',
            mimeType: 'application/json',
          },
        },
        server,
        undefined, // paywallConfig
        undefined, // paywall
        false // syncFacilitatorOnStart — no eager network getSupported in tests
      )
    ).not.toThrow();
    await smokeApp.close();
  });
});
