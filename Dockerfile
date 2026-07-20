# ============================================
# Base
# ============================================
FROM oven/bun:latest AS base
WORKDIR /app

# ============================================
# Dependencies (prod only)
# ============================================
FROM base AS deps
COPY package.json bun.lock ./
ENV NODE_ENV=production
RUN bun install --frozen-lockfile

# ============================================
# Production
# ============================================
FROM base AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3220

EXPOSE ${PORT}

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY tsconfig.json package.json drizzle.config.ts ./
COPY drizzle ./drizzle

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
