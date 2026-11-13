# ---- Stage 1: Install & Build ----
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

COPY apps ./apps
RUN npm run build

# ---- Stage 2: Production Runtime ----
FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends curl tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/bot.db

COPY package.json package-lock.json* ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --omit=dev --workspace=apps/bot --include-workspace-root

COPY --from=builder /app/apps/bot/dist ./apps/bot/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/bot/dist/index.js"]
