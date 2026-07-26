# AMBER — Design System

> The blueprint for amber-mcp.xyz. Direction: **Minimalist + Curvy**. Soft, organic, calm, premium.
> Dark-native, warm amber on near-black. Built for TanStack Start + React 19 + HeroUI + Tailwind 4 + GSAP + Lenis + Motion.
>
> Status note: the Playwright teardown at `web/RESEARCH/REFERENCE_TEARDOWN.md` did not exist when this was authored (only `RESEARCH/screens/01-tmrw-hero.png` — the "Tomorrow" warm full-bleed serif hero). Section 5 (Motion) is authored to be **compatible** with that teardown; when it lands, reconcile exact GSAP timings against it but keep the easing/duration tokens defined here as the source of truth.

---

## 1. Design Language

### The thesis

AMBER is memory made warm. It is **Linear's engineering restraint wearing Claude's warmth**: a near-black canvas where a single amber light source and vast negative space do the talking, but every corner is rounded, every accent is an organic blob, and the type is big and confident rather than dense. We subtract until only the essential remains, then soften what's left. Motion is slow, weighted, and understated — light warming a surface, not UI snapping into place. The result should feel like a premium object: calm, tactile, inevitable.

### Closest matches in the 58-system library

| Rank | System | What we take from it |
|------|--------|----------------------|
| **1** | **`linear.app`** | Dark-as-native-medium (`#08090a` → our `#0a0a0a`). Content emerging from darkness. Semi-transparent white borders instead of solid lines. Elevation by luminance-stepping, not drop shadows. Inter Variable body with a between-weight (Linear's `510`). Aggressive negative tracking on display type. Reserve the one chromatic accent for CTAs/interaction only — here that accent is **amber**, not indigo. |
| **2** | **`claude`** | The warmth. Every neutral carries a yellow-brown undertone — no cool blue-grays anywhere. Generous radii (12–32px). Ring-shadow depth (`0 0 0 1px`) that reads as a soft halo, not a hard border. Editorial pacing: big single-weight headings breathing at tight line-heights, sections alternating "rooms." Terracotta-as-brand logic → our amber-as-brand. |
| **3** | **`apple`** / `tesla` (accent) | Gallery-like, product-as-sculpture negative space and full-bleed hero confidence. The reference `01-tmrw-hero.png` (Tomorrow) sits here too: warm full-bleed image, one oversized headline, a single pill badge, a whispered scroll cue. |

**One-line synthesis:** Linear's discipline and darkness + Claude's warm palette, generous radii and ring-shadows + Apple/Tomorrow's full-bleed gallery hero = AMBER.

### Non-negotiables (the guardrails)
- Dark only. `#0a0a0a` ink is the whitespace.
- **Amber is the only saturated color in the chrome.** The 6-axis reputation hues are the single sanctioned exception, and they appear only inside reputation/portrait visualizations — never in nav, buttons, or body text.
- Every container corner is rounded. Sharp corners (< 8px) are banned on cards, buttons, inputs, media.
- Warm neutrals only. No `#gray-500`, no cool slate. Text is cream at descending opacities.
- Big type, few elements, lots of air. If a section has more than one idea, split it.
- Motion is slow and weighted (400–900ms, expo/quint out). Nothing bounces except the number count-ups.

---

## 2. Color System

Dark, warm, single-accent. Every neutral is cream-tinted; every "black" is warm. Delivered as Tailwind 4 `@theme` tokens (CSS-first) so utilities like `bg-bg`, `text-fg-muted`, `border-line`, `bg-primary` generate automatically.

### 2.1 Background layers (luminance-stepped, Linear model)
| Token | Hex | Role |
|-------|-----|------|
| `--color-bg` | `#0a0a0a` | Page canvas. The deepest layer. This IS the negative space. |
| `--color-bg-raised` | `#121110` | Alternating "room" sections, footer. One warm step up. |
| `--color-surface` | `#1a1613` | Cards, panels — warm charcoal, olive-amber undertone. |
| `--color-surface-2` | `#221c16` | Elevated/hover surface, popovers, active cards. |
| `--color-surface-3` | `#2a2219` | Highest surface — command palette, modals, inset wells. |

Never use pure `#000`. Never use solid fills for a card that could be a translucent `color-mix` of `surface` — but solid warm surfaces are allowed here (unlike Linear) because the warmth needs body.

### 2.2 Text / content (cream at descending opacity)
| Token | Value | Role | Contrast on `#0a0a0a` |
|-------|-------|------|----------------------|
| `--color-fg` | `#fbf7ed` | Primary text, headlines | ~18.6:1 — AAA |
| `--color-fg-secondary` | `color-mix(in srgb, #fbf7ed 78%, transparent)` | Body, descriptions | ~13:1 — AAA |
| `--color-fg-muted` | `color-mix(in srgb, #fbf7ed 62%, transparent)` | Secondary body, captions | ~9:1 — AAA |
| `--color-fg-subtle` | `color-mix(in srgb, #fbf7ed 45%, transparent)` | Metadata, placeholders | ~5.5:1 — AA |
| `--color-fg-faint` | `color-mix(in srgb, #fbf7ed 30%, transparent)` | Footer micro-labels, disabled | ~3.4:1 — large/UI only |

Never use pure `#ffffff` for text — `#fbf7ed` (cream) prevents glare and holds the warm identity.

### 2.3 Brand / primary (amber is the accent)
| Token | Hex | Role |
|-------|-----|------|
| `--color-primary` | `#e4a853` | Baltic amber — primary CTA fill, brand mark, key interactive surface. |
| `--color-primary-bright` | `#f5cb5c` | Wheat — hover state, brightest highlight, active glow. |
| `--color-primary-press` | `#cf9440` | Pressed/active amber (darker, warmer). |
| `--color-primary-soft` | `color-mix(in srgb, #e4a853 14%, transparent)` | Tinted backgrounds, ghost-button hover, chips. |
| `--color-primary-line` | `color-mix(in srgb, #e4a853 32%, transparent)` | Amber-tinted borders on focus/active. |
| `--color-cognac` | `#7c4a0a` | Deep brown — gradient anchor for blobs/mesh, dark amber depth, never text. |
| `--color-on-primary` | `#0a0a0a` | Ink text on amber fills. Contrast `#0a0a0a` on `#e4a853` ≈ 9.1:1 — AAA for the button label. |

**Accessibility rule for amber:** amber-on-ink (`#e4a853` on `#0a0a0a`) ≈ 8.6:1 — safe for large text, icons, and UI labels, and used for the logomark and section eyebrows. Do **not** set amber as small (<16px) body text on cream surfaces or on `bg-raised`; it drops below AA. For amber CTAs always put **ink text on the amber fill**, never amber text on a light fill.

### 2.4 Borders / lines (semi-transparent cream — Linear technique, warm)
| Token | Value | Role |
|-------|-------|------|
| `--color-line` | `color-mix(in srgb, #fbf7ed 8%, transparent)` | Default hairline — section dividers, card edges. |
| `--color-line-strong` | `color-mix(in srgb, #fbf7ed 14%, transparent)` | Emphasized borders, inputs, hover card edge. |
| `--color-line-amber` | `var(--color-primary-line)` | Focus rings, selected/active state. |

Borders are whisper-thin translucent cream, never solid dark lines.

### 2.5 The 6 reputation axes (the sanctioned multi-hue set)
Calm, desaturated, warm-anchored hues that walk amber → cool without shouting. **Only** used inside reputation dials, radar/constellation visuals, and portrait SVGs. Each ~55–70% saturation so they never break the monochrome-amber calm.

| Axis (proposed) | Token | Hex | Feel |
|-----------------|-------|-----|------|
| Reliability | `--color-axis-reliability` | `#e4a853` | Amber (the anchor) |
| Competence | `--color-axis-competence` | `#f0c05a` | Honey/wheat |
| Efficiency | `--color-axis-efficiency` | `#d98b5f` | Warm clay |
| Safety | `--color-axis-safety` | `#9fb083` | Muted sage |
| Consistency | `--color-axis-consistency` | `#6ea9a0` | Dusty teal |
| Collaboration | `--color-axis-collaboration` | `#9a92d6` | Soft lavender |

(Axis names are a proposal — rename to match the API's actual 6 axes; keep the hue order warm→cool so the radar reads as a gradient sweep.)

### 2.6 Semantic (warm, muted — Claude logic)
| Token | Hex | Role |
|-------|-----|------|
| `--color-success` | `#86b37a` | Warm sage-green. Score gains, healthy status, "paid" confirmations. |
| `--color-warning` | `#e0a336` | Amber-warning (distinct from brand by desaturation + context). |
| `--color-danger` | `#c65f4e` | Warm clay-red (never pure red). Errors, score drops. |
| `--color-info` | `#6ea9a0` | Reuses the teal axis for neutral/on-chain info. |

### 2.7 Tokens snippet (`@theme` for `src/styles.css`)
```css
@import "tailwindcss";
@import "@fontsource-variable/inter";
@import "@fontsource-variable/bricolage-grotesque"; /* display */
@import "@fontsource-variable/jetbrains-mono";      /* data/x402/code */

@theme {
  /* backgrounds */
  --color-bg: #0a0a0a;
  --color-bg-raised: #121110;
  --color-surface: #1a1613;
  --color-surface-2: #221c16;
  --color-surface-3: #2a2219;

  /* text (cream) */
  --color-fg: #fbf7ed;
  --color-fg-secondary: color-mix(in srgb, #fbf7ed 78%, transparent);
  --color-fg-muted: color-mix(in srgb, #fbf7ed 62%, transparent);
  --color-fg-subtle: color-mix(in srgb, #fbf7ed 45%, transparent);
  --color-fg-faint: color-mix(in srgb, #fbf7ed 30%, transparent);

  /* brand / amber */
  --color-primary: #e4a853;
  --color-primary-bright: #f5cb5c;
  --color-primary-press: #cf9440;
  --color-primary-soft: color-mix(in srgb, #e4a853 14%, transparent);
  --color-primary-line: color-mix(in srgb, #e4a853 32%, transparent);
  --color-cognac: #7c4a0a;
  --color-on-primary: #0a0a0a;

  /* lines */
  --color-line: color-mix(in srgb, #fbf7ed 8%, transparent);
  --color-line-strong: color-mix(in srgb, #fbf7ed 14%, transparent);

  /* reputation axes */
  --color-axis-reliability: #e4a853;
  --color-axis-competence: #f0c05a;
  --color-axis-efficiency: #d98b5f;
  --color-axis-safety: #9fb083;
  --color-axis-consistency: #6ea9a0;
  --color-axis-collaboration: #9a92d6;

  /* semantic */
  --color-success: #86b37a;
  --color-warning: #e0a336;
  --color-danger: #c65f4e;
  --color-info: #6ea9a0;

  /* fonts */
  --font-sans: "Inter Variable", "Inter", system-ui, sans-serif;
  --font-display: "Bricolage Grotesque Variable", "Inter Variable", sans-serif;
  --font-mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace;

  /* radii (the curvy scale) */
  --radius-xs: 8px;
  --radius-sm: 12px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-xl: 32px;
  --radius-2xl: 48px;
  --radius-pill: 9999px;

  /* motion easings */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-warm: cubic-bezier(0.33, 1, 0.68, 1);
}
```

---

## 3. Typography

### Pairing (recommended)
- **Display / headings — `Bricolage Grotesque` (Variable).** A soft, contemporary grotesque with gentle ink-traps and slightly organic terminals — confident at huge sizes, warm rather than clinical, and it carries an optical-size axis. This is the "curvy" voice: rounded personality without tipping into playful. On Google Fonts + `@fontsource-variable/bricolage-grotesque`.
  - *Alt if you want the reference's editorial serif elegance instead:* `Fraunces` (variable, soft optical serif) for hero moments only. Pick **one** — do not run both.
- **Body / UI — `Inter Variable`** (already installed). Enable OpenType `"cv01"` (single-story a) for a rounder, softer read that harmonizes with Bricolage. Use a Linear-style between-weight of **`480`** as the default UI emphasis (our signature weight — softer than 500).
- **Data / x402 / code — `JetBrains Mono` (Variable).** For addresses, USDT₮0 amounts, chain IDs, MCP tool signatures, x402 payloads. `@fontsource-variable/jetbrains-mono`.

### Type scale
Display uses Bricolage with negative tracking (Linear-style compression); body uses Inter at relaxed line-heights (Claude-style breathing).

| Role | Font | Size | Weight | Line-height | Tracking | Use |
|------|------|------|--------|-------------|----------|-----|
| Display XL | Bricolage | `clamp(3.5rem, 8vw, 6.5rem)` (56–104px) | 600 | 0.98 | -0.03em | Hero headline, one per page |
| Display L | Bricolage | `clamp(2.75rem, 5vw, 4rem)` (44–64px) | 600 | 1.02 | -0.025em | Section anchors |
| Display M | Bricolage | `2.25rem` (36px) | 600 | 1.08 | -0.02em | Sub-section, big stat labels |
| Heading 1 | Bricolage | `1.75rem` (28px) | 600 | 1.15 | -0.015em | Card group titles |
| Heading 2 | Inter | `1.375rem` (22px) | 560 | 1.3 | -0.01em | Feature titles, card headers |
| Heading 3 | Inter | `1.125rem` (18px) | 560 | 1.4 | normal | Small headings, list titles |
| Body L | Inter | `1.1875rem` (19px) | 400 | 1.6 | normal | Hero sub, intro paragraphs |
| Body | Inter | `1rem` (16px) | 400 | 1.6 | normal | Standard reading text |
| Body Medium | Inter | `1rem` (16px) | 480 | 1.5 | normal | Nav, labels, emphasis |
| Small | Inter | `0.875rem` (14px) | 400 | 1.55 | normal | Captions, secondary body |
| Eyebrow | Inter | `0.75rem` (12px) | 560 | 1.4 | 0.18em, UPPERCASE | Section labels (amber) |
| Micro | Inter | `0.6875rem` (11px) | 480 | 1.4 | 0.08em | Footer, badges |
| Mono | JetBrains | `0.8125rem` (13px) | 400 | 1.5 | normal | Addresses, amounts, code, tool names |
| Mono Label | JetBrains | `0.6875rem` (11px) | 500 | 1.4 | 0.02em | Chain tags, x402 metadata |

### Rules
- **One Display XL per page.** The hero headline is the loudest thing; nothing else competes.
- Display always runs **negative tracking**; body always `normal` or positive. Never the reverse.
- Eyebrows are amber (`--color-primary`), uppercase, wide-tracked — the only place amber text appears at small size, and only on `bg`/`bg-raised` where it clears contrast.
- Body copy at 1.6 line-height (editorial breathing). Do not go below 1.5 for paragraphs.
- All numeric/financial values (USDT₮0, scores, chain 196, per-call fees) render in **mono** — data should look like data.
- Reputation scores (0–100) use Display M/L in Bricolage for the big number, mono for the "/100" suffix.

---

## 4. Shape & Space Language

### 4.1 Radius scale — the "curvy" system
| Token | px | Applied to |
|-------|-----|-----------|
| `--radius-xs` | 8 | Inline chips, tags, small badges, inputs (min radius — never smaller) |
| `--radius-sm` | 12 | Buttons, list rows, small cards |
| `--radius-md` | 16 | Standard cards, nav dropdown, code blocks |
| `--radius-lg` | 24 | Feature cards, panels, media frames |
| `--radius-xl` | 32 | Hero containers, large showcase panels, embedded demos |
| `--radius-2xl` | 48 | Full-bleed rounded section wells, the demo "stage" |
| `--radius-pill` | 9999 | Pills, badges ("Live on X Layer", "Chain 196"), CTA option to be fully pill, avatars, toggles |

Signature move: **pill-shaped primary CTAs** and **pill status badges** everywhere, with `--radius-xl`/`2xl` on the big content containers. This is what sells "curvy."

### 4.2 Organic blob & gradient-mesh accents
The one decorative system. Replaces the flat radial mesh currently in `AmberLanding.tsx`.
- **Blobs:** large, very-soft-blurred amber→cognac radial shapes with organic `border-radius` (e.g. `border-radius: 42% 58% 63% 37% / 45% 38% 62% 55%`), `filter: blur(80–120px)`, opacity `0.10–0.18`, positioned off-canvas edges. They drift slowly (see Motion). One or two per section max.
- **Gradient mesh (hero):** `radial-gradient(ellipse 70% 50% at 50% -10%, color-mix(in srgb, var(--color-primary) 22%, transparent) 0%, transparent 60%)` layered with a cognac bloom at a corner. Keep total opacity low (≤ 0.15) — light warming the dark, never a bright wash.
- **Grain (optional):** a 3–4% opacity noise overlay (`mix-blend-mode: overlay`) to keep gradients from banding and add premium texture. Reuse `ModularGrid` only if it can be softened; default to blobs.
- Blobs are `pointer-events-none`, `aria-hidden`, `fixed`/`absolute` behind content, and respect `prefers-reduced-motion` (freeze drift).

### 4.3 Spacing scale (8px base, generous)
`4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160` (px). Tailwind's `1,2,3,4,6,8,12,16,24,32,40`.
- Section vertical padding: **`py-24 md:py-40`** (96 → 160px). Air is the product.
- Card internal padding: `24–32px` (`p-6 md:p-8`).
- Container max width: **1200px**, centered, `px-6 md:px-12`.
- Hero min-height: `88–92vh`, content vertically centered, generous left/top offset.

### 4.4 Elevation (warm ring shadows, not drop shadows)
Depth comes from luminance-stepping the surface + a warm ring halo. Traditional dark drop shadows are invisible and banned as the primary cue.
| Level | Treatment | Use |
|-------|-----------|-----|
| 0 Flat | `bg`, no shadow | Page canvas |
| 1 Contained | `surface` bg + `1px solid var(--color-line)` | Standard cards |
| 2 Ring | `box-shadow: 0 0 0 1px var(--color-line-strong)` | Interactive/hover card edge |
| 3 Lifted | `surface-2` bg + `0 8px 40px rgba(0,0,0,0.5)` + inner `0 0 0 1px var(--color-line)` | Featured cards, demo stage |
| 4 Amber-focus | `0 0 0 1px var(--color-primary-line), 0 0 24px color-mix(in srgb, var(--color-primary) 25%, transparent)` | Focused input, active reputation card, CTA hover glow |
| 5 Overlay | `surface-3` bg + `0 24px 80px rgba(0,0,0,0.7)` + `1px solid var(--color-line-strong)` | Modals, command palette |

The **amber glow (Level 4)** is the signature hover/active affordance — a warm light turning on, used sparingly on the primary CTA and the active reputation/portrait card.

---

## 5. Motion Language

Reuse the existing tokens in `src/config/animation.ts` (they already encode the right easings) and extend. Principle: **slow, weighted, warm — light settling onto a surface.** Nothing is snappy except number count-ups. Everything respects `prefers-reduced-motion`.

### 5.1 Easing & duration tokens
- Primary reveal easing: **`EASE_OUT_EXPO` `[0.16, 1, 0.3, 1]`** (already in config) — long, confident deceleration.
- Secondary: `EASE_OUT_QUINT` for shorter UI moves.
- Micro-interactions: `TRANSITION_DEFAULT` (300ms) / `TRANSITION_FAST` (200ms).
- Durations: reveals **600–900ms**; micro-interactions **150–300ms**; blob drift **20–40s** loops; preloader **≤ 1.2s**.
- Only the reputation score count-up uses a spring with slight bounce (`SPRING_BOUNCE_ONE`) — the one "alive" moment.

### 5.2 Where each library is used
| Library | Responsibility |
|---------|----------------|
| **Lenis** | Global smooth scroll (already wired in `LenisSmoothScrollProvider`). Lerp ~0.08–0.1 for weighted glide. Drives the scroll-linked blob parallax and progress. |
| **GSAP + ScrollTrigger** | Section reveals, pinned sequences (how-it-works "identity in → memory out → attest" pin-scrub), the memory-portrait constellation draw-on, horizontal reputation-axis reveal. Keep GSAP for anything scroll-scrubbed or sequenced. |
| **Motion (Framer)** | Component micro-interactions: button hover glow, magnetic CTA, card hover-lift, pill badge entrances, tab transitions, the count-up. Use the `FADE_IN_UP` / `SCALE_IN` presets already defined. |
| **AnimateComponent** | Keep for simple declarative on-scroll `fadeInUp` reveals in content sections (it's GSAP under the hood). |

### 5.3 Signature motions
1. **Preloader (≤1.2s):** ink screen, the AMBER wordmark fades up in Bricolage while a soft amber blob blooms behind it, then the whole layer wipes up with a rounded-corner mask reveal (`ease-out-expo`). Shows once per session (sessionStorage). Skip entirely under reduced-motion.
2. **Hero text reveal:** headline animates in by **line-mask** (each line clipped, translated up 100% → 0, staggered 80ms). Sub and CTA follow with `fadeInUp` at 180/360ms delay. Mirrors the Tomorrow reference's confident single-headline entrance.
3. **Scroll cue:** a whispered "/ scroll" + a slow-bobbing chevron (2s loop) bottom-left of hero, exactly like the reference.
4. **Blob drift:** background blobs slowly morph `border-radius` and translate on a 24–40s loop (GSAP `yoyo`), plus a subtle scroll-parallax via Lenis. Frozen under reduced-motion.
5. **Reputation reveal:** the 0–100 score **counts up** (spring) as the card scrolls into view; the 6-axis radar/constellation **draws its strokes** (GSAP `strokeDashoffset`) axis by axis, each in its axis hue.
6. **Memory-portrait constellation:** generative SVG nodes fade+scale in with stagger, connecting lines draw on; on hover, nodes gently attract toward the cursor (Motion). This is the emotional centerpiece — let it breathe.
7. **Magnetic primary CTA:** pill button subtly follows the cursor within a few px and lifts its amber glow (Level 4) on hover.
8. **Section "rooms":** alternate `bg` / `bg-raised` between sections; on enter, a very slow ambient blob shifts hue-position so each room feels lit differently (Claude's chapter rhythm).

Restraint rule: **max one signature motion per section.** If two want to fire, cut one.

---

## 6. Landing Page — Section Inventory

Single scroll, `bg` canvas with alternating `bg-raised` rooms. Container 1200px, `px-6 md:px-12`.

1. **Nav (sticky, minimal)** — Left: chevron/blob logomark + `AMBER` wordmark (Bricolage, amber). Right: `How it works · Reputation · Developers · Pricing` (Inter 480, `fg-muted` → `fg` on hover) + one pill CTA `Explore on OKX.AI`. Backdrop-blur on scroll, hairline `--color-line` bottom border appears past 40px. Mobile: hamburger → rounded full-height sheet.

2. **Hero (~90vh)** — Eyebrow pill `● Live on X Layer · Chain 196` (amber dot, pill, `--radius-pill`). Display XL headline: **"Agents that remember. Reputation that's earned."** Body L sub (~2 lines): persistent memory + on-chain reputation for the OKX AI agent marketplace, paid per call in USDT₮0. Two CTAs: primary pill `Explore agents` (amber, ink text, magnetic + glow) and ghost `Read the docs` (line border, `fg-secondary`). Bottom-left `/ scroll` cue. Background: hero gradient-mesh + one drifting amber blob. Signature motion: line-mask headline reveal.

3. **Proof / trust strip** — `bg-raised`. A calm row of mono stats with hairline dividers: `33 MCP tools · REST + x402 · ERC-8004 identity · 5 verticals · USDT₮0 on X Layer`. Optional logo/wordmark row (OKX.AI). Numbers count-up on enter. Low, quiet, confidence-building.

4. **How it works (pinned 3-step)** — Eyebrow `HOW IT WORKS`. Display L: "Identity in. Memory out. Reputation on-chain." Pinned ScrollTrigger sequence, 3 steps scrub: (01) Key by ERC-8004 identity → (02) Remember across every job (write/recall via MCP or REST) → (03) Earn reputation, attested on X Layer. Left column = sticky big number + title; right column = illustrative rounded panel per step. Reduced-motion → plain 3-card grid.

5. **Reputation showcase** — `bg-raised`. Eyebrow `REPUTATION`. Display L: "A 0–100 score across six axes." Centerpiece: a large rounded (`--radius-xl`) card holding the **6-axis radar/constellation** in the axis hues, with a huge Bricolage score number (count-up) and mono `/100`. Beside it, six small rows (axis name · hue dot · mono value) revealing on scroll. Signature: radar strokes draw axis-by-axis.

6. **Memory portrait (generative visual)** — Full-bleed rounded "stage" (`--radius-2xl`, `surface` well, Level 3 lift). The generative SVG **portrait constellation** — an agent's memory rendered as a warm node-graph. Copy left/overlay: "Every memory becomes part of a portrait." Signature: constellation draw-on + hover node-attraction. The emotional peak of the page; maximum air around it.

7. **x402 / pricing** — Eyebrow `PRICING`. Display L: "Pay per call. Priced in USDT₮0." A clean rounded pricing card (or 2–3 pill-tabbed cards) using live `config.pricing`: Memory Write, Recall, Bulk, Session Context — each row: name · mono fee · one-line detail · "first N free" note. Mono-heavy. x402 explainer chip. Hover → Level 4 amber glow on the active card.

8. **For developers / MCP** — `bg-raised`. Eyebrow `FOR DEVELOPERS`. Display L: "33 MCP tools. One identity." Two-up: left = prose (A2MCP, REST, x402 exact-scheme, ERC-8004) with a pill link to docs; right = a rounded (`--radius-md`) code/terminal panel in JetBrains Mono showing an MCP tool call + x402 payment header. Copy-button micro-interaction.

9. **Footer CTA** — Full-width `bg-raised` well, centered. Big Bricolage wordmark `AMBER` with a soft blob behind it. Tagline (`config.tagline`). Two pill CTAs: `Explore on OKX.AI` (amber) + `#OKXAI` (ghost). Then a minimal footer: mono micro row `AMBER · Persistent memory + on-chain reputation` / `X Layer · Chain 196 · x402 · ERC-8004`, nav links, socials.

---

## 7. Route Plan

Currently only `/` exists. Proposed full set (TanStack file-based routes in `src/routes/`):

| Route | Purpose | Key sections |
|-------|---------|--------------|
| `/` | Landing — the pitch. | Sections 1–9 above. |
| `/how-it-works` | Deep explainer of the memory + reputation + attestation flow. | Extended pinned sequence, ERC-8004 identity model, X Layer attestation diagram, A2MCP overview, FAQ. |
| `/reputation` | **Reputation explorer** — browse/search agents and their scores. | Search + filter bar, sortable agent grid (rounded cards with mini radar + score), axis legend, leaderboard by axis. |
| `/reputation/$agentId` | Single agent's live reputation. | Big score + full 6-axis radar, per-axis breakdown, history sparkline, recent attested jobs (mono), link to its portrait. |
| `/portraits` | **Portrait gallery** — the generative memory constellations. | Masonry/organic grid of portrait SVGs, filter by vertical, hover-to-animate. The most visual, most "curvy" page. |
| `/portraits/$agentId` | One agent's full portrait + memory stats. | Large interactive constellation, memory count/timeline, provenance. |
| `/agents` | For agents / the 5 marketplace verticals. | Vertical cards, "why give your agent memory + reputation," onboarding CTA to OKX.AI. |
| `/developers` | Integration hub. | 33 MCP tools reference, REST endpoints, x402 payment flow, ERC-8004 identity, quickstart code panels. (Full API reference may live in external `/docs`.) |
| `/pricing` | Full pricing + x402 mechanics. | Per-call pricing table (from `config.pricing`), free-tier explainer, x402 exact-scheme walkthrough, USDT₮0 on X Layer notes. |
| `/manifesto` *(optional)* | Brand/vision piece — leans hardest into editorial + air. | Long-form warm essay layout, one signature illustration/blob per scroll beat. |

Shared: root layout with sticky nav + footer + preloader + Lenis (already provided). 404/error → reuse `ErrorPage.tsx`, restyled to tokens (rounded, warm, one blob).

---

## 8. Implementation Checklist (for the frontend-engineer)

**Phase 1 — Tokens & fonts**
- [ ] Replace `src/styles.css` `:root` block with the `@theme` snippet from §2.7 (keep the existing `@custom-variant dark`, scrollbar, selection — but restyle scrollbar thumb to `--color-primary-press` and give it `border-radius: 9999px`).
- [ ] Add font imports: `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/jetbrains-mono` (install via bun). Keep Inter.
- [ ] Set `font-feature-settings: "cv01"` on `body`; wire `--font-display` / `--font-sans` / `--font-mono`.
- [ ] Update `html/body` background to `var(--color-bg)`, text `var(--color-fg)`.

**Phase 2 — Layout primitives**
- [ ] `Container` (max-w-[1200px], `px-6 md:px-12`), `Section` (`py-24 md:py-40`, optional `bg-raised` room prop).
- [ ] `Blob` component (organic border-radius, blur, drift via Motion/GSAP, `aria-hidden`, reduced-motion aware) + `HeroMesh` gradient.
- [ ] Restyle HeroUI theme tokens (or wrap) so `Button`/`Card`/`Input` inherit radii + amber primary + warm surfaces.
- [ ] Primitives: `Eyebrow`, `PillBadge`, `Button` (primary pill / ghost), `Card` (Level 1–3), `Stat`, `MonoValue`.

**Phase 3 — Motion foundation**
- [ ] Add `--ease-*` easings + extend `config/animation.ts` if needed (expo already there).
- [ ] `Preloader` (session-gated, mask-wipe, reduced-motion skip).
- [ ] `TextReveal` (line-mask) util for headlines; `CountUp` (spring) for numbers.
- [ ] Confirm Lenis lerp ~0.09; hook scroll to blob parallax.

**Phase 4 — Landing sections** (rebuild `AmberLanding.tsx` to §6)
- [ ] Nav → Hero → Proof → How-it-works (pinned) → Reputation showcase → Memory portrait → Pricing (from `config.pricing`) → Developers/MCP → Footer CTA.
- [ ] Keep `MemoryDemo` — reskin to tokens, place inside a `--radius-2xl` Level-3 stage.
- [ ] Reputation radar + generative portrait SVG components (axis hues from §2.5).

**Phase 5 — Routes**
- [ ] Scaffold routes from §7; extract shared `<SiteNav>` / `<SiteFooter>` into root layout.
- [ ] Wire reputation + portrait pages to `src/lib/amber-api.ts`.

**Phase 6 — Verify**
- [ ] Every color from tokens (no raw hex in JSX except inside SVG gradients/blobs).
- [ ] No corner < 8px; primary CTAs are pills; amber only as accent/CTA/eyebrow.
- [ ] Contrast: body ≥ AA, amber never small-on-light. Test with `prefers-reduced-motion` on.
- [ ] Type: one Display XL per page; data in mono; Bricolage negative-tracked, Inter body 1.6.
- [ ] Reconcile GSAP timings with `RESEARCH/REFERENCE_TEARDOWN.md` once it exists.
