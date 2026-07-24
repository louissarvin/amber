# syntax=docker/dockerfile:1.7
# =============================================================================
# AMBER backend — multi-stage Bun 1.x on Debian slim
# =============================================================================

FROM oven/bun:1.1-debian AS builder

WORKDIR /app

# Install OS deps required for prisma-adapter-pg / native modules
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Deps first for layer cache
COPY package.json bun.lockb* package-lock.json* ./
RUN bun install --frozen-lockfile

# Source + generate prisma client
COPY . .
RUN bunx prisma generate --config prisma/prisma.config.ts

# -----------------------------------------------------------------------------
# Runtime stage
# -----------------------------------------------------------------------------
FROM oven/bun:1.1-debian AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd --user-group --create-home --shell /bin/false amber

COPY --from=builder --chown=amber:amber /app /app

USER amber

EXPOSE 3700

# Basic healthcheck against /livez (fast, no external dep calls)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3700/livez || exit 1

CMD ["bun", "index.ts"]
