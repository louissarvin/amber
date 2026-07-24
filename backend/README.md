# AMBER backend

Persistent, portable memory-as-a-service for AI agents. This is the service an agent connects to over MCP to write and recall memories that persist across every client, settle per call in USDT via x402, and anchor to X Layer with a Merkle attestation.

## What it does

- **Memory write and query** keyed to an ERC-8004 identity, with pgvector semantic recall.
- **x402 `exact` payment gate** on paid routes. The agent signs an EIP-3009 authorization, the middleware verifies and settles in USDT on X Layer (`eip155:196`).
- **Merkle attestation** of every memory. A batch worker rolls new memories into a tree and commits the root on-chain so any memory has a verifiable inclusion proof.
- **MCP streamable-http transport** at `/mcp`, JSON-RPC 2.0, protocol version `2025-06-18`.
- **Vertical services** on the same store: Finance Copilot brief, Lifestyle Companion, AMBER reputation score, SEALSCRIBE decree seals, and memory constellation portraits.

## Stack

Fastify 5, Bun on Node 20, Prisma 7 against Postgres with pgvector, Redis for quota and queues, `node-cron` background workers, `ethers` for X Layer, OpenAI for embeddings. Deployed to Fly.io.

## Run locally

Prerequisites: Bun 1.x, Postgres 16 with the `vector` extension, Redis.

```bash
cd backend
bun install
cp .env.example .env      # fill in DATABASE_URL, XLAYER_RPC, ASP keys
bun run db:push           # push the Prisma schema
bun run dev               # http://localhost:3700
```

Verify it is up:

```bash
curl http://localhost:3700/healthz
curl http://localhost:3700/
```

## Project structure

```
index.ts               Entry point. Registers every route, plugin, and worker.
dotenv.ts              Environment loader.
src/config/            Centralized env config and validation.
src/routes/            Fastify route plugins grouped by prefix.
src/services/          Business logic: memory, attestation, identity, seals, portraits.
src/lib/               Integrations: prisma, redis, xlayer, x402, okx, openai, merkle.
src/middlewares/       x402 gate, origin allowlist, auth.
src/workers/           node-cron jobs: attestation batcher, retry, sweeper, settler.
src/schemas/           zod request schemas.
prisma/schema.prisma   Database schema.
contracts/             Foundry project for the X Layer attestation contract.
tests/                 Bun test suites.
```

## Key routes

| Route | Purpose |
|-------|---------|
| `POST /memory/write` | Write a memory (paid via x402) |
| `GET /memory/query` | Semantic recall over an identity's memories |
| `GET /memory/session-context` | Rehydrate an agent session |
| `POST /mcp` | MCP streamable-http transport |
| `GET /:id/attestation` | Merkle inclusion proof for a memory |
| `POST /seal/generate` | SEALSCRIBE wax-seal decree |
| `GET /portrait/:address.svg` | Memory constellation portrait |
| `GET /healthz` | Readiness probe |
| `GET /metrics` | Live operations snapshot |
| `GET /docs` | Swagger UI |

## Security notes

- `.env` is never committed. Secrets are loaded at boot and validated by `validateConfig()`.
- Paid routes fail closed. A malformed or replayed x402 authorization is rejected before any work is done.
- The USDT EIP-712 domain is read from chain at startup so signatures cannot be forged against a stale domain.
- MCP origins are constrained by an allowlist independent of CORS.

## License

MIT.
