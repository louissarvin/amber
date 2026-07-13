// -----------------------------------------------------------------------------
// Memory Portrait — pure-math radial SVG renderer (v2).
//
// Renders an agent's memory graph as a living constellation: categories cluster
// around a central AMBER sigil, individual memories orbit their category hub.
// No external layout library — deterministic trig-based placement.
//
// v2 enhancements:
//   - Starfield background with pseudo-random seeded dots
//   - Gradient fills on category hubs (glow effect)
//   - Curved bezier spokes for organic feel
//   - Outer decorative ring with tick marks
//   - Memory node pulse animation (CSS)
// -----------------------------------------------------------------------------

export interface PortraitNode {
  id: string;
  content: string;
  category: string;
  tags: string[];
  // Timelapse-only: which time-slice (0-indexed) this memory first appeared in.
  // Ignored unless PortraitInput.frames is set. Controls staggered fade-in.
  bucket?: number;
}

export interface PortraitInput {
  address: string;
  totalMemories: number;
  nodes: PortraitNode[];
  // When set (2..12), the renderer emits a self-contained animated SVG whose
  // memory nodes fade in bucket-by-bucket, oldest first, replaying the
  // identity's lifetime as a looping timelapse. When absent, output is
  // byte-identical to the classic single-frame portrait.
  frames?: number;
}

const CANVAS = 1000;
const CENTER = CANVAS / 2;
const HUB_RADIUS = 230;
const ORBIT_MIN = 90;
const ORBIT_MAX = 130;
const HUB_CIRCLE_R = 48;
const NODE_R = 7;
const CENTER_R = 30;
const OUTER_RING_R = 460;
const TICK_COUNT = 72;

// Timelapse: one full replay loop (buildup + hold) in seconds. Deterministic
// so the same identity+data always yields the same SVG.
const TIMELAPSE_DUR = '14s';
// Fraction of the loop spent revealing buckets; the remainder holds the full
// constellation before the loop restarts.
const TIMELAPSE_BUILDUP = 0.8;

const HUB_COLORS = [
  '#E4A853', // amber
  '#F07C6E', // coral
  '#7EC8A4', // sage
  '#7EB5E4', // sky
  '#B07EE4', // violet
  '#E47EB5', // rose
  '#E4C07E', // gold
  '#7EE4D4', // teal
];

const AMBER_GOLD = '#E4A853';
const CREAM = '#FBF7ED';
const BG = '#080808';
const LINE_MUTED = '#2A2A2A';

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

// Simple seeded pseudo-random for deterministic star fields.
const seededRand = (seed: number): (() => number) => {
  let s = seed;
  return (): number => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return ((s >>> 0) / 4294967296);
  };
};

const buildStarfield = (seed: string, count: number): string => {
  // Derive a numeric seed from first 8 chars of address.
  const numSeed = parseInt(seed.slice(2, 10), 16) || 0xdeadbeef;
  const rand = seededRand(numSeed);
  const dots: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = rand() * CANVAS;
    const y = rand() * CANVAS;
    const r = 0.5 + rand() * 1.2;
    const op = (0.15 + rand() * 0.5).toFixed(2);
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${CREAM}" opacity="${op}"/>`);
  }
  return dots.join('');
};

interface HubLayout {
  category: string;
  color: string;
  x: number;
  y: number;
  angle: number;
  nodes: PortraitNode[];
  gradId: string;
}

const buildHubs = (nodes: PortraitNode[]): HubLayout[] => {
  const byCategory = new Map<string, PortraitNode[]>();
  for (const node of nodes) {
    const key = node.category || 'note';
    const existing = byCategory.get(key);
    if (existing) {
      existing.push(node);
    } else {
      byCategory.set(key, [node]);
    }
  }

  const categories = Array.from(byCategory.keys());
  const total = categories.length;
  if (total === 0) return [];

  return categories.map((category, i) => {
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
    const x = CENTER + HUB_RADIUS * Math.cos(angle);
    const y = CENTER + HUB_RADIUS * Math.sin(angle);
    return {
      category,
      color: HUB_COLORS[i % HUB_COLORS.length] ?? AMBER_GOLD,
      x,
      y,
      angle,
      nodes: byCategory.get(category) ?? [],
      gradId: `hubGrad${i}`,
    };
  });
};

// Quadratic bezier control point (center pulled slightly outward for a
// graceful arc instead of a rigid straight spoke).
const bezierSpoke = (hx: number, hy: number): string => {
  const cp = { x: (CENTER + hx) / 2, y: (CENTER + hy) / 2 };
  const off = 30;
  const cpx = cp.x + off * Math.cos(Math.atan2(hy - CENTER, hx - CENTER) + Math.PI / 2);
  const cpy = cp.y + off * Math.sin(Math.atan2(hy - CENTER, hx - CENTER) + Math.PI / 2);
  return `<path d="M ${CENTER} ${CENTER} Q ${cpx.toFixed(2)} ${cpy.toFixed(2)} ${hx.toFixed(2)} ${hy.toFixed(2)}" fill="none" stroke="${LINE_MUTED}" stroke-width="0.7" opacity="0.4"/>`;
};

// Builds a SMIL fade-in animation for a memory node in a given time-bucket.
// The node stays invisible until its bucket's reveal point, fades to full, then
// holds until the loop restarts, so the constellation visibly grows over time.
// Self-contained (no JS/CSS), so the SVG works as a static shareable asset.
const buildFadeIn = (bucket: number, frames: number): string => {
  const clamped = Math.min(Math.max(bucket, 0), frames - 1);
  const t0 = (clamped / frames) * TIMELAPSE_BUILDUP;
  const fade = Math.min(0.06, TIMELAPSE_BUILDUP / frames);
  const t1 = Math.min(t0 + fade, TIMELAPSE_BUILDUP);
  // Avoid duplicate keyTimes (SMIL requires a strictly usable list) when the
  // first bucket reveals at t=0.
  const keyTimes = t0 <= 0
    ? `0;${t1.toFixed(4)};1`
    : `0;${t0.toFixed(4)};${t1.toFixed(4)};1`;
  const values = t0 <= 0 ? '0;1;1' : '0;0;1;1';
  return `<animate attributeName="opacity" dur="${TIMELAPSE_DUR}" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}" values="${values}"/>`;
};

const renderHub = (hub: HubLayout, frames?: number): string => {
  const memCount = hub.nodes.length;
  const label = escapeXml(truncate(hub.category, 13));

  const nodeMarkup = hub.nodes
    .slice(0, 24) // cap at 24 nodes per hub to avoid clutter
    .map((node, i) => {
      const nodeAngle = memCount === 1
        ? hub.angle
        : (i / memCount) * Math.PI * 2;
      const orbitR = ORBIT_MIN + ((ORBIT_MAX - ORBIT_MIN) * (i % 4)) / 3;
      const nx = hub.x + orbitR * Math.cos(nodeAngle);
      const ny = hub.y + orbitR * Math.sin(nodeAngle);
      const tip = escapeXml(truncate(node.content, 72));
      const glowOp = (0.6 + 0.4 * ((i % 3) / 2)).toFixed(2);
      const inner = [
        `<line x1="${hub.x.toFixed(1)}" y1="${hub.y.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${hub.color}" stroke-width="0.4" opacity="0.25"/>`,
        `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${NODE_R + 3}" fill="${hub.color}" opacity="0.12"/>`,
        `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${NODE_R}" fill="${hub.color}" opacity="${glowOp}" class="mem-node"><title>${tip}</title></circle>`,
      ].join('');
      // Timelapse mode wraps the node in a fade-in group; classic mode emits
      // the exact same markup as before (byte-identical default output).
      if (frames === undefined) return inner;
      return `<g opacity="0">${buildFadeIn(node.bucket ?? 0, frames)}${inner}</g>`;
    })
    .join('');

  const spoke = bezierSpoke(hub.x, hub.y);

  // Hub glow aura.
  const aura = `<circle cx="${hub.x.toFixed(1)}" cy="${hub.y.toFixed(1)}" r="${HUB_CIRCLE_R + 14}" fill="${hub.color}" opacity="0.07"/>`;
  const hubFill = `<circle cx="${hub.x.toFixed(1)}" cy="${hub.y.toFixed(1)}" r="${HUB_CIRCLE_R}" fill="url(#${hub.gradId})" stroke="${hub.color}" stroke-width="1.2" opacity="0.9"/>`;
  const countBadge = memCount > 0
    ? `<text x="${hub.x.toFixed(1)}" y="${(hub.y - 4).toFixed(1)}" text-anchor="middle" font-family="Inter,Helvetica,sans-serif" font-size="14" font-weight="600" fill="${CREAM}">${label}</text><text x="${hub.x.toFixed(1)}" y="${(hub.y + 13).toFixed(1)}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="${CREAM}" opacity="0.65">${memCount}</text>`
    : `<text x="${hub.x.toFixed(1)}" y="${(hub.y + 5).toFixed(1)}" text-anchor="middle" font-family="Inter,Helvetica,sans-serif" font-size="13" font-weight="500" fill="${CREAM}">${label}</text>`;

  return `${spoke}${nodeMarkup}${aura}${hubFill}${countBadge}`;
};

const buildGradientDefs = (hubs: HubLayout[]): string => {
  return hubs.map((h) =>
    `<radialGradient id="${h.gradId}" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="${CREAM}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${h.color}" stop-opacity="0.8"/>
    </radialGradient>`
  ).join('');
};

const buildOuterRing = (): string => {
  const ticks: string[] = [];
  for (let i = 0; i < TICK_COUNT; i += 1) {
    const angle = (i / TICK_COUNT) * Math.PI * 2;
    const major = i % 6 === 0;
    const r1 = OUTER_RING_R - (major ? 10 : 5);
    const r2 = OUTER_RING_R;
    const x1 = CENTER + r1 * Math.cos(angle);
    const y1 = CENTER + r1 * Math.sin(angle);
    const x2 = CENTER + r2 * Math.cos(angle);
    const y2 = CENTER + r2 * Math.sin(angle);
    ticks.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${AMBER_GOLD}" stroke-width="${major ? 1.2 : 0.5}" opacity="${major ? 0.6 : 0.25}"/>`);
  }
  return [
    `<circle cx="${CENTER}" cy="${CENTER}" r="${OUTER_RING_R}" fill="none" stroke="${AMBER_GOLD}" stroke-width="0.7" opacity="0.3"/>`,
    ...ticks,
  ].join('');
};

export const renderPortraitSvg = (input: PortraitInput): string => {
  const { frames } = input;
  const hubs = buildHubs(input.nodes);
  const gradDefs = buildGradientDefs(hubs);
  const hubMarkup = hubs.map((h) => renderHub(h, frames)).join('');
  const starfield = buildStarfield(input.address, 140);
  const outerRing = buildOuterRing();

  const shortAddr = escapeXml(`${input.address.slice(0, 6)}…${input.address.slice(-4)}`);
  // Appending the timelapse suffix only when frames is set keeps the classic
  // (no-frames) caption — and therefore the whole SVG — byte-identical.
  const countLabel = escapeXml(
    `${input.totalMemories} memor${input.totalMemories === 1 ? 'y' : 'ies'}${frames ? ` · lifetime timelapse` : ''}`
  );

  // Center sigil — amber disc with inner ring and AMBER wordmark.
  const centerSigil = `
    <circle cx="${CENTER}" cy="${CENTER}" r="${CENTER_R + 18}" fill="none" stroke="${AMBER_GOLD}" stroke-width="0.5" opacity="0.3"/>
    <circle cx="${CENTER}" cy="${CENTER}" r="${CENTER_R + 8}" fill="${AMBER_GOLD}" opacity="0.12"/>
    <circle cx="${CENTER}" cy="${CENTER}" r="${CENTER_R}" fill="${AMBER_GOLD}" opacity="0.97"/>
    <text x="${CENTER}" y="${CENTER + 5}" text-anchor="middle" font-family="Inter,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="3" fill="${BG}">AMBER</text>
  `;

  // Dashed guide ring at hub radius.
  const guideRing = `<circle cx="${CENTER}" cy="${CENTER}" r="${HUB_RADIUS}" fill="none" stroke="${LINE_MUTED}" stroke-width="0.6" opacity="0.4" stroke-dasharray="3 5"/>`;

  // Animate memory nodes with a subtle pulse (pure CSS, no JS).
  const style = `<style>
    .mem-node { animation: pulse 3s ease-in-out infinite alternate; }
    @keyframes pulse { from { opacity: 0.75; r: ${NODE_R}px; } to { opacity: 1; r: ${NODE_R + 1.5}px; } }
  </style>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    ${gradDefs}
    <radialGradient id="bgGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#111111"/>
      <stop offset="100%" stop-color="${BG}"/>
    </radialGradient>
  </defs>
  ${style}
  <rect width="${CANVAS}" height="${CANVAS}" fill="url(#bgGrad)"/>
  ${starfield}
  ${outerRing}
  ${guideRing}
  ${hubMarkup}
  ${centerSigil}
  <text x="${CENTER}" y="${CANVAS - 44}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="12" fill="${CREAM}" opacity="0.45">${shortAddr}</text>
  <text x="${CENTER}" y="${CANVAS - 26}" text-anchor="middle" font-family="Inter,Helvetica,sans-serif" font-size="11" fill="${AMBER_GOLD}" opacity="0.65" letter-spacing="2">${countLabel}</text>
</svg>`;
};
