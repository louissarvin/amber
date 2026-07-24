import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { closeRedis } from './helpers.ts';

// -----------------------------------------------------------------------------
// x402 price consistency.
//
// The published /.well-known/x402 manifest is what buyers and the OKX/x402
// Bazaar discovery layer read to learn AMBER's prices. Its handler builds every
// `accepts[].amount` from the PRICE_*_ATOMIC constants in main-config.ts. This
// spec spins up the real discoveryRoutes plugin and injects a request (no DB is
// touched by the manifest handler) to prove the surfaced amounts equal config.
// -----------------------------------------------------------------------------

let app: FastifyInstance;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let manifest: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cfg: any;
let byPath: Record<string, string | undefined>;

beforeAll(async () => {
  cfg = await import('../src/config/main-config.ts');
  const { discoveryRoutes } = await import('../src/routes/discoveryRoutes.ts');
  app = Fastify();
  app.register(discoveryRoutes);
  await app.ready();
  const res = await app.inject({ method: 'GET', url: '/.well-known/x402' });
  expect(res.statusCode).toBe(200);
  manifest = JSON.parse(res.body);
  byPath = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manifest.endpoints.map((e: any) => [e.path, e.accepts[0]?.amount])
  );
});

afterAll(async () => {
  if (app) await app.close();
  await closeRedis();
});

describe('/.well-known/x402 manifest', () => {
  test('is x402 v2', () => {
    expect(manifest.x402Version).toBe(2);
  });

  test('write endpoint amount === PRICE_WRITE_ATOMIC', () => {
    expect(byPath['/memory/write']).toBe(String(cfg.PRICE_WRITE_ATOMIC));
  });

  test('query + memory-by-id amounts === PRICE_QUERY_ATOMIC', () => {
    expect(byPath['/memory/query']).toBe(String(cfg.PRICE_QUERY_ATOMIC));
    expect(byPath['/memory/:id']).toBe(String(cfg.PRICE_QUERY_ATOMIC));
  });

  test('session-context amount === PRICE_SESSION_CONTEXT_ATOMIC', () => {
    expect(byPath['/memory/session-context']).toBe(
      String(cfg.PRICE_SESSION_CONTEXT_ATOMIC)
    );
  });

  test('seal amount === PRICE_SEAL_ATOMIC', () => {
    expect(byPath['/seal/generate']).toBe(String(cfg.PRICE_SEAL_ATOMIC));
  });

  test('export amount === PRICE_EXPORT_ATOMIC', () => {
    expect(byPath['/memory/export']).toBe(String(cfg.PRICE_EXPORT_ATOMIC));
  });

  test('paid accepts settle in USD₮0 on X Layer via the exact scheme', () => {
    const write = manifest.endpoints.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.path === '/memory/write'
    );
    const accept = write.accepts[0];
    // Canonical OKX-supported X Layer settlement asset: USD₮0.
    expect(accept.asset).toBe('0x779ded0c9e1022225f8e0630b35a9b54be713736');
    expect(accept.asset).toBe(cfg.USDT_XLAYER_ADDRESS);
    expect(accept.network).toBe('eip155:196');
    expect(accept.network).toBe(`eip155:${cfg.XLAYER_CHAIN_ID}`);
    expect(accept.scheme).toBe('exact');
  });

  test('exact extra is exactly { name: "USD₮0", version: "1" } — no non-standard keys', () => {
    const write = manifest.endpoints.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.path === '/memory/write'
    );
    const accept = write.accepts[0];
    expect(accept.extra).toEqual({ name: 'USD₮0', version: '1' });
    expect(accept.extra.assetTransferMethod).toBeUndefined();
    // ₮ must be the Tugrik sign U+20AE, not ASCII "USDT0".
    expect(accept.extra.name.charCodeAt(3)).toBe(0x20ae);
  });
});

describe('published listing fees match config atomic prices (÷1e6 USDT)', () => {
  // scripts/listing-services.json fees are the human-decimal USDT versions of
  // the atomic config prices. This ties the marketplace listing to config.
  test('listing fees are the decimal form of PRICE_*_ATOMIC', async () => {
    const { readFileSync } = await import('node:fs');
    const { repoPath } = await import('./helpers.ts');
    const listing = JSON.parse(
      readFileSync(repoPath('scripts/listing-services.json'), 'utf8')
    ) as Array<{ serviceName: string; fee: string }>;
    const feeOf = (name: string): number =>
      Number(listing.find((s) => s.serviceName === name)?.fee);

    expect(feeOf('Memory Write')).toBeCloseTo(cfg.PRICE_WRITE_ATOMIC / 1e6, 9);
    expect(feeOf('Memory Recall')).toBeCloseTo(cfg.PRICE_QUERY_ATOMIC / 1e6, 9);
    expect(feeOf('Session Context')).toBeCloseTo(
      cfg.PRICE_SESSION_CONTEXT_ATOMIC / 1e6,
      9
    );
    expect(feeOf('Seal Generate')).toBeCloseTo(cfg.PRICE_SEAL_ATOMIC / 1e6, 9);
  });
});
