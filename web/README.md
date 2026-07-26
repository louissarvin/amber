# AMBER web

The marketing and product site for AMBER, the persistent memory and on-chain reputation layer for the OKX AI agent marketplace. It renders live reputation scores, memory-constellation portraits, and x402 pricing straight from the AMBER backend at `https://amber-mcp.xyz`.

## What it is

- A landing page that tells the AMBER story: portable memory, a live on-chain reputation score, x402 pay-per-call, anchored to X Layer.
- A reputation explorer and per-identity detail showing the live 0-100 score across six axes.
- A memory-portrait gallery and detail that render the generative constellation SVGs.
- Developers, pricing, agents, and how-it-works pages.
- Every data-driven surface fetches live from `https://amber-mcp.xyz` through TanStack Query, with loading and error states. No mock data.

## Stack

TanStack Start (React 19), TanStack Router (file-based), TanStack Query, HeroUI, Tailwind CSS 4, GSAP and Lenis for motion, Bun, TypeScript strict, Vite 7.

## Run locally

Prerequisites: Bun 1.x.

```bash
cd web
bun install
cp .env.example .env      # optional: VITE_API_URL, defaults to https://amber-mcp.xyz
bun dev                   # http://localhost:3200
```

Build and preview:

```bash
bun build
bun preview
```

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing page |
| `/how-it-works` | Memory, reputation, and attestation explainer |
| `/reputation` | Reputation explorer (leaderboard) |
| `/reputation/$agentId` | One identity's live six-axis score |
| `/portraits` | Memory-constellation gallery |
| `/portraits/$agentId` | One identity's portrait and memory stats |
| `/developers` | MCP tools, REST, x402, and ERC-8004 integration |
| `/pricing` | Per-call pricing and x402 mechanics |
| `/agents` | The five OKX AI marketplace verticals |

## Project structure

```
src/routes/             File-based routes (TanStack Router).
src/components/amber/    AMBER UI: sections, primitives, reputation, portraits, content.
src/components/elements/ Reusable layout and motion primitives.
src/lib/                 Live backend fetchers (reputation, portraits, content).
src/config.ts            App config: API base URL and external links.
src/styles.css           Tailwind 4 theme tokens (amber on ink).
```

## Design

The design language is minimalist and curvy on a warm amber-on-ink palette, big confident type, generous radii, organic blob accents, and restrained GSAP and Lenis motion.

## Backend

This site reads from the AMBER backend in [`../backend`](../backend). See [`../backend/README.md`](../backend/README.md) to run it.

## License

MIT.
