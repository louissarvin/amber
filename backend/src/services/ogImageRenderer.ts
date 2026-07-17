import { Resvg } from '@resvg/resvg-js';

// -----------------------------------------------------------------------------
// OG image renderer — SVG → PNG conversion for Twitter/OG social cards.
//
// Uses @resvg/resvg-js (pure Rust WASM, no external deps) to render the
// existing portrait and seal SVGs into 1200×630 PNG cards suitable for
// og:image / twitter:image tags. Same source SVG, higher-density output.
// -----------------------------------------------------------------------------

const TWITTER_OG_WIDTH = 1200;
const TWITTER_OG_HEIGHT = 630;

// Render an SVG string to a PNG buffer at the target width. Height is
// preserved by aspect ratio unless the caller supplies fitTo.
export const renderSvgToPng = (
  svg: string,
  opts: { width?: number; height?: number; background?: string } = {}
): Buffer => {
  const resvg = new Resvg(svg, {
    fitTo: opts.height
      ? { mode: 'height', value: opts.height }
      : { mode: 'width', value: opts.width ?? TWITTER_OG_WIDTH },
    background: opts.background ?? '#1A1410',
    font: {
      // Load system fonts so the AMBER wordmark and stats are visible in the
      // OG PNG. Falls back to whichever serif/sans font is available on the
      // host — Georgia, DejaVu Serif, Liberation Serif all render the card
      // consistently enough for Twitter/OG previews.
      loadSystemFonts: true,
      defaultFontFamily: 'Georgia',
    },
  });
  return Buffer.from(resvg.render().asPng());
};

// Wrap an inner SVG in a 1200×630 amber-branded frame for Twitter cards.
// Used for portrait and seal share cards so they render at the correct
// aspect ratio regardless of the source SVG's dimensions.
export const buildTwitterCard = (opts: {
  title: string;
  subtitle?: string;
  innerSvg?: string;
  identity?: string;
  stats?: Array<{ label: string; value: string }>;
}): string => {
  const escape = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const title = escape(opts.title).slice(0, 60);
  const subtitle = opts.subtitle ? escape(opts.subtitle).slice(0, 100) : '';
  const identity = opts.identity ? escape(opts.identity) : '';
  const stats = opts.stats ?? [];

  // Render the inner SVG inside a bounded viewport, positioned on the right.
  // A `preserveAspectRatio="xMidYMid meet"` avoids distortion.
  const innerSvgBlock = opts.innerSvg
    ? `<g transform="translate(720, 105)"><svg width="420" height="420" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet">${opts.innerSvg}</svg></g>`
    : '';

  const statLines = stats
    .slice(0, 4)
    .map(
      (s, i) => `
    <text x="80" y="${350 + i * 42}" font-family="Georgia, serif" font-size="26" fill="#FBF7ED" opacity="0.85">
      <tspan font-weight="700" fill="#E4A853">${escape(s.value)}</tspan> <tspan opacity="0.7">${escape(s.label)}</tspan>
    </text>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${TWITTER_OG_WIDTH}" height="${TWITTER_OG_HEIGHT}" viewBox="0 0 ${TWITTER_OG_WIDTH} ${TWITTER_OG_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1A1410"/>
      <stop offset="60%" stop-color="#221A12"/>
      <stop offset="100%" stop-color="#0F0B08"/>
    </linearGradient>
    <radialGradient id="glow" cx="15%" cy="20%" r="55%">
      <stop offset="0%" stop-color="#E4A853" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#E4A853" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${TWITTER_OG_WIDTH}" height="${TWITTER_OG_HEIGHT}" fill="url(#bg)"/>
  <rect width="${TWITTER_OG_WIDTH}" height="${TWITTER_OG_HEIGHT}" fill="url(#glow)"/>

  <!-- AMBER wordmark -->
  <text x="80" y="120" font-family="Georgia, serif" font-size="72" fill="#E4A853" font-weight="700" letter-spacing="6">AMBER</text>
  <text x="80" y="160" font-family="Georgia, serif" font-size="20" fill="#FBF7ED" opacity="0.6" letter-spacing="4">MEMORY LAYER · X LAYER · x402</text>

  <!-- Title + subtitle -->
  <text x="80" y="245" font-family="Georgia, serif" font-size="42" fill="#FBF7ED" font-weight="600">${title}</text>
  ${subtitle ? `<text x="80" y="285" font-family="Georgia, serif" font-size="22" fill="#FBF7ED" opacity="0.75">${subtitle}</text>` : ''}

  <!-- Stats -->
  ${statLines}

  <!-- Identity footer -->
  ${identity ? `<text x="80" y="580" font-family="'Courier New', monospace" font-size="18" fill="#E4A853" opacity="0.7">${identity}</text>` : ''}

  <!-- Amber inner constellation / seal art on the right -->
  ${innerSvgBlock}

  <!-- Border accent -->
  <rect x="4" y="4" width="${TWITTER_OG_WIDTH - 8}" height="${TWITTER_OG_HEIGHT - 8}" fill="none" stroke="#E4A853" stroke-opacity="0.35" stroke-width="2" rx="8"/>
</svg>`;
};
