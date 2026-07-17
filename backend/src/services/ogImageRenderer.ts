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
