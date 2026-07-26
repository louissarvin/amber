# AMBER Reference Teardown

Target: minimalist + curvy dark-amber marketing site for AMBER (persistent memory + on-chain reputation layer, OKX AI agent marketplace). Ink `#0a0a0a`, amber `#e4a853`, wheat `#f5cb5c`, cream `#fbf7ed`. Stack: TanStack Start, React 19, HeroUI, Tailwind 4, GSAP 3, Lenis, Motion.

17/18 sites captured. `jpeg.fun` failed both attempts — HTTP 402 "Deployment Paused" (Vercel project suspended, not a code issue). Excluded below.

Screenshots live in `web/RESEARCH/screens/<n>-<name>-{hero,mid}.png`.

---

## Site blocks

### 1. Tomorrow Protocol — tmrw.finance
`01-tmrw-hero.png` / `01-tmrw-mid.png`
- **Layout**: single-column narrative, full-bleed photographic hero, stacked prose sections below.
- **Effects**: motion-blurred subway photo hero (static asset, not live video); body paragraph split into individually-spanned words (`<span>` per word) for what is almost certainly a scroll-triggered word-by-word opacity reveal.
- **Tech**: Next.js (`__variable_*` font classes), no global `gsap`/`lenis` exposed → likely Framer Motion bundled internally (tree-shaken, invisible to `window`).
- **Type/color**: serif display headline (elegant, editorial) on warm sepia photo; otherwise near-black/cream.
- **Minimalist 4/5, Curvy 2/5** (only pill buttons are curvy).

### 2. Opal Exchange — opaldex.com
`02-opaldex-hero.png` / `02-opaldex-mid.png`
- **Layout**: pure black canvas, left-aligned serif headline, right-side floating iridescent 3D-render blobs.
- **Effects**: two soap-bubble/liquid-glass renders (pre-rendered image/video assets, not live WebGL — no canvas detected) positioned absolute over black; frosted white pill navbar; gradient pill CTA.
- **Tech**: Next.js, `sfPro` font, no gsap/lenis globals.
- **Type/color**: black bg, white/cream serif italic for emphasis words, holographic pastel accents on the blobs only.
- **Minimalist 4/5, Curvy 5/5** — best "organic blob on black" reference in the set.

### 3. Agently — use-agently.com
`03-agently-hero.png` / `03-agently-mid.png`
- **Layout**: centered marketplace headline, small human/machine toggle control.
- **Tech**: Next.js, Geist font, no gsap/lenis/canvas detected.
- **Minimalist 4/5, Curvy 2/5.**

### 4. jpeg.fun — FAILED (HTTP 402, deployment paused). Skipped.

### 5. Floe Labs — floelabs.xyz
`05-floelabs-hero.png` / `05-floelabs-mid.png`
- **Layout**: dark, terminal/dev-tool feel, code block front and center in hero.
- **Tech**: **Framer** site (`events.framer.com`, `framerusercontent.com/.../script_main.mjs`) — confirms Framer as production tool, not Framer Motion in a custom app.
- **Type/color**: near-black bg, green/cyan wordmark accent, monospace code block.
- **Minimalist 5/5, Curvy 2/5** (sharp-cornered logo, otherwise plain).

### 6. Liminal — becomeliminal.com
`06-liminal-hero.png` / `06-liminal-mid.png`
- **Layout**: full-bleed photographic hero (runners, warm olive tone), centered headline + single CTA.
- **Tech**: no gsap/lenis/canvas globals; monospace body font (`Helvetica Monospaced Pro`) mixed with serif headline.
- **Type/color**: orange sunburst logo mark + orange pill CTA — closest accent hue to our amber of any site tested.
- **Minimalist 3/5, Curvy 3/5** (pill buttons, sunburst mark).

### 7. SynauLearn — synaulearn.com
`07-synaulearn-hero.png` / `07-synaulearn-mid.png`
- **Layout**: playful, mascot-driven (cat decorations flank hero), canvas-based hero illustration.
- **Tech**: Bricolage Grotesque font, no gsap/lenis globals.
- **Minimalist 2/5, Curvy 4/5** — too cute/decorative for AMBER's tone, not a strong reference.

### 8. Nuvia Finance — nuviafinance.com
`08-nuvia-hero.png` / `08-nuvia-mid.png`
- **Layout**: light theme, split hero (copy left, phone mockup right in a coral rounded card).
- **Effects**: 4 `<canvas>` elements present (likely small particle/chart effects, not confirmed WebGL).
- **Tech**: "Open Runde" — a genuinely rounded geometric font, worth noting as a *typographic* curvy signal.
- **Minimalist 3/5, Curvy 4/5.**

### 9. ChainGPT Labs — labs.chaingpt.org
`09-chaingptlabs-hero.png` / `09-chaingptlabs-mid.png`
- **Layout**: blueprint/dashboard grid with dashed cell borders, giant draggable/scrubbed marquee headline ("BACKING TOMORROW"), horizontal pinned 17-slide "how it works" list.
- **Tech (gold mine)**: `gsap@3.11.5` + `ScrollTrigger` + `EasePack` + **SplitText** + **ScrambleTextPlugin** + `swiper@11` + `lenis@1.1.16`, plus a WebGL `<canvas>` explicitly labeled "This is a canvas scene" in the accessibility tree (three.js pattern).
- **Type/color**: RobotoMono, off-white/black blueprint aesthetic, orange accent CTAs.
- **Minimalist 2/5, Curvy 1/5** — visually not a style match, but the **single best tech-stack validation** in the set: this is almost exactly our stack (GSAP + ScrollTrigger + SplitText + Lenis) proven in production.

### 10. Raflux — raflux.io
`10-raflux-hero.png` / `10-raflux-mid.png`
- **Layout**: dark, HUD/terminal feel ("Client Network / Websocket Connection" footer readout).
- **Tech**: 2 canvases, 1 confirmed WebGL context, Kode Mono font, no gsap/lenis globals detected.
- **Minimalist 3/5, Curvy 1/5.**

### 11. Sui — sui.io
`11-sui-hero.png` / `11-sui-mid.png`
- **Layout**: Webflow site, blue gradient hero, headline captured mid-animation with a blur-to-focus effect ("Build full stack" — outer words still blurred, center word sharp).
- **Tech (gold mine)**: Webflow-hosted **full GSAP plugin arsenal** — `gsap@3.15.0` + ScrollTrigger + SplitText + CustomEase + InertiaPlugin + Observer + Draggable + DrawSVGPlugin + ScrambleTextPlugin + MorphSVGPlugin + Flip — plus `lenis@1.3.23`. 15 `<canvas>` elements scattered through the page (many small WebGL/SVG animation instances).
- **Type/color**: "TWK Everett" display font, blue gradient bg, white text.
- **Minimalist 3/5, Curvy 3/5** — the blur-to-focus text reveal is the standout, highly stealable effect.

### 12. Sui Overflow — overflow.sui.io
`12-overflow-hero.png` / `12-overflow-mid.png`
- **Tech**: same family as sui.io — `gsap@3.12.7` + ScrollTrigger + CustomEase + Flip + SplitText + ScrambleTextPlugin + MorphSVGPlugin + `lenis@1.1.14`. Same TWK Everett font.
- **Minimalist 3/5, Curvy 2/5.**

### 13. Slush — slush.app
`13-slush-hero.png` / `13-slush-mid.png`
- **Layout**: chunky black "SLUSH" wordmark overlapping a thick blue 3D organic tube/squiggle shape, sticker-like rotated decorative icons (rocket, coin, wink emoji), infinite marquee banner across the very top ("Slush Card Waitlist is Live" repeated).
- **Tech (gold mine)**: `gsap@3.12.7` + ScrollTrigger + CustomEase + Draggable + Observer + Flip + InertiaPlugin + SplitText, **`@barba/core@2.9.7`** (page-transition library) + `lenis@1.1.14`. Aeonik Pro font.
- **Minimalist 1/5, Curvy 5/5** — maximalist/playful, not a style match for AMBER, but the marquee banner and Barba page-transition pattern are worth stealing individually.

### 14. Walrus — walrus.xyz
`14-walrus-hero.png` / `14-walrus-mid.png`
- **Layout**: pure black bg, huge bold confident sans headline, gradient (blue→purple) announcement banner at top, pill nav, pill CTA.
- **Tech**: no gsap/lenis/canvas globals exposed (React app, likely internal Framer Motion/CSS not visible on `window`). Custom "Ratch" display font.
- **Content note**: top banner literally reads *"Take your AI agent's memory anywhere with Walrus Memory"* — directly adjacent product category to AMBER.
- **Minimalist 5/5, Curvy 3/5** — best typographic-restraint reference in the set.

### 15. Suiet — suiet.app
`15-suiet-hero.png` / `15-suiet-mid.png`
- **Tech**: **Framer** site (`events.framer.com` script) + one WebGL `<canvas>` in hero (likely a soft gradient blob render).
- **Minimalist 3/5, Curvy 3/5.**

### 16. Cetus — cetus.zone
`16-cetus-hero.png` / `16-cetus-mid.png`
- **Layout**: entire hero sits inside one **giant rounded-rect container** (~32-40px radius) with a radial glow background; frosted-glass/liquid whale sculpture render (teal/green) floats across it.
- **Tech**: Inter font, no gsap/lenis/canvas globals (likely Framer Motion bundled, invisible on `window`). 19 console errors present (unrelated third-party scripts, not a red flag for the pattern itself).
- **Minimalist 3/5, Curvy 5/5** — the single-giant-rounded-card hero treatment is the best "curvy but premium, not cutesy" reference in the whole set.

### 17. PIVY — pivy.me
`17-pivy-hero.png` / `17-pivy-mid.png`
- **Layout**: light theme, mint-green accent, large rounded-corner phone mockup + app icon (~28px radius), rounded pill search input and CTA.
- **Tech**: "Open Runde" rounded font again, no gsap/lenis globals.
- **Minimalist 3/5, Curvy 5/5.**

### 18. Suiperpower — suiperpower.dev
`18-suiperpower-hero.png` / `18-suiperpower-mid.png`
- **Layout**: dark bg, soft blue radial glow blob bleeding off two corners, glossy rounded app icon, monospace `curl | bash` install command, generous negative space, single pill "Install" button.
- **Tech**: no gsap/lenis/canvas-webgl globals besides one WebGL canvas (glow likely CSS radial-gradient + blur, not the canvas).
- **Minimalist 5/5, Curvy 4/5** — structurally the closest template to what AMBER should be: swap the blue glow for amber/wheat and this is nearly the layout.

---

## PATTERN LIBRARY

**Page loader / preloader**
None of the 17 sites ran a classic full-screen spinner/logo preloader on load. The closest analog is Sui's blur-to-focus headline reveal, which functions as a "load-in" moment without blocking the page. *Recommendation for AMBER*: skip a traditional preloader (adds friction, hurts LCP) — do an instant hero mask/blur reveal instead (see Hero motion below), consistent with the Rauno/Emil Kowalski restraint principle.

**Hero motion**
Best: **sui.io** — headline text blurred at rest, sharpens + fades in on load. Build with GSAP `SplitText` (chars or words) + `gsap.from(chars, {filter: 'blur(8px)', opacity: 0, y: 12, stagger: 0.02, ease: 'power3.out'})`. GSAP's `filter` blur animation is GPU-cheap on short text.

**Smooth scroll (Lenis)**
Best: **sui.io, overflow.sui.io, slush.app, labs.chaingpt.org** — all four wire raw Lenis to `ScrollTrigger.update()` via the official GSAP+Lenis integration recipe (`lenis.on('scroll', ScrollTrigger.update)` + drive Lenis's `raf` from `gsap.ticker`). Our `LenisSmoothScrollProvider` already exists — just needs the ScrollTrigger sync hook added, not a second Lenis instance.

**Scroll-triggered reveals**
Best: **labs.chaingpt.org, sui.io** — staggered fade/slide-in on card grids and section headers as they enter viewport. Build with `ScrollTrigger.batch()` for grids (batches simultaneous intersections into one stagger) — extends the existing `AnimateComponent onScroll` pattern rather than replacing it.

**Text animations (split/mask/scramble)**
Best: **labs.chaingpt.org, sui.io, overflow.sui.io, slush.app** all load GSAP `SplitText` + `ScrambleTextPlugin`. `tmrw.finance` achieves a similar word-by-word reveal without GSAP (per-word `<span>`s, likely Framer Motion stagger). *Note*: confirm current GSAP plugin licensing before use — WebFetch gsap.com docs, as Club GreenSock plugin bundling changed in 2025.

**Curvy / organic shapes**
Best: **cetus.zone** (one giant `rounded-[2.5rem]`+ hero container is the single highest-leverage curvy move — cheap, zero JS) and **opaldex.com** (iridescent blob renders as static image/video assets layered on black, not live 3D — affordable to replicate). Build: Tailwind `rounded-[2.5rem]` on hero card; 2-3 absolutely-positioned `bg-amber-400/20 blur-3xl rounded-full` divs behind content, drifted slowly with GSAP `yoyo: true, repeat: -1` (8-12s duration) or Motion `animate` loops.

**Hover / cursor**
No site in this set ran a full custom-cursor replacement (none evidenced in captures). *Recommendation*: skip custom cursor entirely — matches AMBER's restraint brief. Use magnetic/arrow-shift micro-interactions instead (see Top 8 below).

**Sticky / pinned storytelling**
Best: **labs.chaingpt.org** — "how it works" renders as a `1/17 … 17/17` pinned horizontal list, almost certainly a `ScrollTrigger.create({pin: true})` + Swiper-driven horizontal scrub. Directly applicable to AMBER's memory-write → reputation-score → agent-discovery flow as a 3-4 step pinned horizontal scrubber.

**Marquees**
Best: **slush.app** (top banner, "Slush Card Waitlist is Live" repeated edge-to-edge) and **labs.chaingpt.org** (partner logo strip). Build as pure CSS: duplicate content, `@keyframes marquee { to { transform: translateX(-50%) } }`, `animation-play-state: paused` under `prefers-reduced-motion` — zero JS, zero bundle cost.

**Micro-interactions**
Best: **walrus.xyz / suiperpower.dev** pill CTAs (simple `group-hover:translate-x-1` arrow shift) and **opaldex.com**'s frosted-glass pill navbar (`backdrop-blur-xl` white pill floating on black — translates directly to `bg-ink-900/60 backdrop-blur-xl border border-amber-400/10 rounded-full` for AMBER).

---

## TOP 8 STEAL LIST (ranked, highest impact first)

1. **Single giant rounded-corner hero card** — ref: cetus.zone (`16-cetus-hero.png`). Wrap the hero in one `rounded-[2.5rem]` ink-black card with an amber radial glow bleeding from one corner. Cheapest, highest-leverage "curvy" signal; pure Tailwind, no JS.
2. **Blur-to-focus SplitText headline reveal** — ref: sui.io (`11-sui-hero.png`). GSAP `SplitText` + animated `filter: blur()` and opacity/y stagger on load. Sets tone immediately, matches "smooth motion" brief.
3. **Slow-drifting amber ambient glow blobs** — ref: opaldex.com blobs + suiperpower.dev radial glow (`02-opaldex-hero.png`, `18-suiperpower-hero.png`). 2-3 blurred `bg-amber-400/20 blur-3xl rounded-full` divs behind hero content, GSAP `yoyo:true repeat:-1` drift over 8-12s. Establishes warm-on-ink mood cheaply.
4. **Lenis→ScrollTrigger sync + `ScrollTrigger.batch` reveals** — ref: chaingpt labs, sui.io, overflow.sui.io (`09-chaingptlabs-mid.png`, `11-sui-mid.png`). Wire existing `LenisSmoothScrollProvider` to `ScrollTrigger.update`, batch-stagger feature-card grids.
5. **Pinned horizontal "how it works" scrubber** — ref: chaingpt labs 17-slide pinned list (`09-chaingptlabs-mid.png`). Pin AMBER's 3-4 step flow (memory write → on-chain attestation → reputation score → agent discovery) and scrub horizontally against vertical scroll via `ScrollTrigger.create({pin:true})`.
6. **CSS-only infinite marquee for trust strip** — ref: slush.app banner, chaingpt labs logo strip (`13-slush-hero.png`). OKX marketplace / partner logos or live reputation-score ticker, pure CSS keyframe loop, respects `prefers-reduced-motion`.
7. **Frosted-glass floating pill navbar** — ref: opaldex.com (`02-opaldex-hero.png`). `bg-ink-900/60 backdrop-blur-xl border border-amber-400/10 rounded-full` nav on HeroUI Navbar, floating with margin from viewport top.
8. **Magnetic / arrow-shift primary CTA** — ref: walrus.xyz, suiperpower.dev pill buttons (`14-walrus-hero.png`, `18-suiperpower-hero.png`). Motion `useSpring` subtle cursor-follow tilt + `group-hover:translate-x-1` arrow icon shift. Restrained, no custom cursor needed.

---

## Closest-match shortlist for MINIMALIST + CURVY dark-amber

1. **suiperpower.dev** — dark bg, single soft color-glow blob, rounded glossy icon, monospace code accent, generous whitespace. Structurally the nearest template to AMBER; swap blue glow for amber/wheat.
2. **cetus.zone** — giant single rounded-hero-card + organic glass-render shape. Best reference for making "curvy" read premium rather than cute; commission an amber/wheat liquid-glass abstract render in place of the teal whale.
3. **walrus.xyz** — ink-black bg, huge confident bold sans headline, pill nav/CTA, gradient banner strip, and literally an AI-agent-memory product — closest conceptual and typographic match.
4. **opaldex.com** — pure black + iridescent organic blobs + serif italic emphasis + frosted pill nav. Best reference for elevating "blob" motifs without looking like a kids' app.

Stack validation note: 4 of the 17 sites (labs.chaingpt.org, sui.io, overflow.sui.io, slush.app) independently converge on GSAP + ScrollTrigger + SplitText + Lenis as the production combo for this exact dark-crypto aesthetic space — strong external validation that AMBER's chosen stack is the right one, not just internally convenient.
