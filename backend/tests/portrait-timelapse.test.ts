import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  renderPortraitSvg,
  type PortraitInput,
} from '../src/lib/portrait/svgRenderer.ts';
import { closeRedis, dbReachable } from './helpers.ts';

// -----------------------------------------------------------------------------
// Portrait timelapse feature.
//
// The pure renderer (svgRenderer.ts) is tested directly with synthetic in-memory
// nodes — no DB. The frames bounds contract (2..12) is enforced at the route
// layer (portraitRoutes.ts) BEFORE any DB call, so out-of-bounds rejection is
// tested via a real Fastify inject that never reaches Postgres. The accept side
// (valid frames reaching the not-found path) is DB-dependent and skips with a
// message when Postgres is unreachable.
// -----------------------------------------------------------------------------

const synthNodes = (n: number): PortraitInput['nodes'] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    content: `memory number ${i}`,
    category: ['note', 'fact', 'goal', 'preference'][i % 4],
    tags: [],
    bucket: i % 4,
  }));

const baseInput: PortraitInput = {
  address: '0x00000000000000000000000000000000deadbeef',
  totalMemories: 8,
  nodes: synthNodes(8),
};

afterAll(closeRedis);

describe('renderPortraitSvg — classic (no frames)', () => {
  const svg = renderPortraitSvg(baseInput);

  test('emits a valid SVG document', () => {
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg');
  });

  test('contains NO <animate> element', () => {
    expect(svg.includes('<animate')).toBe(false);
  });

  test('contains NO "timelapse" caption', () => {
    expect(svg.includes('timelapse')).toBe(false);
  });
});

describe('renderPortraitSvg — timelapse (frames=8)', () => {
  const svg = renderPortraitSvg({ ...baseInput, frames: 8 });

  test('DOES contain <animate> (SMIL fade-in)', () => {
    expect(svg.includes('<animate')).toBe(true);
  });

  test('DOES contain the "lifetime timelapse" caption', () => {
    expect(svg).toContain('timelapse');
  });

  test('an <animate> exists per rendered node (capped at 24/hub)', () => {
    const count = (svg.match(/<animate/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(baseInput.nodes.length);
  });
});

describe('renderPortraitSvg — determinism', () => {
  test('same classic input => byte-identical output', () => {
    expect(renderPortraitSvg(baseInput)).toBe(renderPortraitSvg(baseInput));
  });

  test('same timelapse input => byte-identical output', () => {
    expect(renderPortraitSvg({ ...baseInput, frames: 8 })).toBe(
      renderPortraitSvg({ ...baseInput, frames: 8 })
    );
  });

  test('frames set vs unset produce different output', () => {
    expect(renderPortraitSvg(baseInput)).not.toBe(
      renderPortraitSvg({ ...baseInput, frames: 8 })
    );
  });

  test('empty memory set with frames still emits no <animate>', () => {
    const empty = renderPortraitSvg({
      address: baseInput.address,
      totalMemories: 0,
      nodes: [],
      frames: 8,
    });
    expect(empty.includes('<animate')).toBe(false);
  });
});

describe('frames bounds contract (route layer, 2..12)', () => {
  let app: FastifyInstance;
  let MIN: number;
  let MAX: number;
  const addr = '0x' + 'ab'.repeat(20);

  beforeAll(async () => {
    const svc = await import('../src/services/portraitService.ts');
    MIN = svc.TIMELAPSE_MIN_FRAMES;
    MAX = svc.TIMELAPSE_MAX_FRAMES;
    const { portraitRoutes } = await import('../src/routes/portraitRoutes.ts');
    app = Fastify();
    app.register(portraitRoutes, { prefix: '/portrait' });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  test('exported bounds are 2..12', () => {
    expect(MIN).toBe(2);
    expect(MAX).toBe(12);
  });

  // These reject BEFORE any DB call, so they run without Postgres.
  test.each(['0', '1', '13', '1.5', 'abc', '-3', '100'])(
    'frames=%s is rejected with 400',
    async (frames) => {
      const res = await app.inject({
        method: 'GET',
        url: `/portrait/${addr}.svg?frames=${frames}`,
      });
      expect(res.statusCode).toBe(400);
    }
  );

  test('valid frames=8 passes validation and reaches lookup (DB-gated)', async () => {
    const ok = await dbReachable();
    if (!ok) {
      console.warn(
        '[SKIP] DATABASE_URL unreachable — cannot verify the accept-side lookup path for frames=8. Out-of-bounds rejection (above) is validated DB-free.'
      );
      return;
    }
    // Random unregistered identity: validation passes (not 400); the service
    // finds no memories and the route returns 404 — proving 8 is in-bounds.
    const res = await app.inject({
      method: 'GET',
      url: `/portrait/${addr}.svg?frames=8`,
    });
    expect(res.statusCode).not.toBe(400);
    expect([404, 200]).toContain(res.statusCode);
  });
});
