# =============================================================================
# Guthwine Multi-Stage Dockerfile
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base image with pnpm
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# -----------------------------------------------------------------------------
# Stage 2: Dependencies
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/database/package.json ./packages/database/
COPY packages/api/package.json ./packages/api/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/cli/package.json ./packages/cli/

RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 3: Builder
# -----------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/
COPY . .

# Generate Prisma client
RUN cd packages/database && npx prisma generate

# Build all packages
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# -----------------------------------------------------------------------------
# Stage 4: API Server
# -----------------------------------------------------------------------------
FROM node:20-alpine AS api
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S guthwine && \
    adduser -S guthwine -u 1001 -G guthwine

# Copy built artifacts
COPY --from=builder --chown=guthwine:guthwine /app/node_modules ./node_modules
COPY --from=builder --chown=guthwine:guthwine /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=guthwine:guthwine /app/packages/core/package.json ./packages/core/
COPY --from=builder --chown=guthwine:guthwine /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=guthwine:guthwine /app/packages/database/package.json ./packages/database/
COPY --from=builder --chown=guthwine:guthwine /app/packages/database/prisma ./packages/database/prisma
COPY --from=builder --chown=guthwine:guthwine /app/packages/api/dist ./packages/api/dist
COPY --from=builder --chown=guthwine:guthwine /app/packages/api/package.json ./packages/api/
COPY --from=builder --chown=guthwine:guthwine /app/package.json ./

# Copy Prisma client
COPY --from=builder --chown=guthwine:guthwine /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=guthwine:guthwine /app/node_modules/@prisma ./node_modules/@prisma

USER guthwine

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/api/dist/server.js"]

# -----------------------------------------------------------------------------
# Stage 5: MCP Server
# -----------------------------------------------------------------------------
FROM node:20-alpine AS mcp
WORKDIR /app

RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 -S guthwine && \
    adduser -S guthwine -u 1001 -G guthwine

COPY --from=builder --chown=guthwine:guthwine /app/node_modules ./node_modules
COPY --from=builder --chown=guthwine:guthwine /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=guthwine:guthwine /app/packages/core/package.json ./packages/core/
COPY --from=builder --chown=guthwine:guthwine /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=guthwine:guthwine /app/packages/database/package.json ./packages/database/
COPY --from=builder --chown=guthwine:guthwine /app/packages/database/prisma ./packages/database/prisma
COPY --from=builder --chown=guthwine:guthwine /app/packages/api/dist ./packages/api/dist
COPY --from=builder --chown=guthwine:guthwine /app/packages/api/package.json ./packages/api/
COPY --from=builder --chown=guthwine:guthwine /app/packages/mcp/dist ./packages/mcp/dist
COPY --from=builder --chown=guthwine:guthwine /app/packages/mcp/package.json ./packages/mcp/
COPY --from=builder --chown=guthwine:guthwine /app/package.json ./

COPY --from=builder --chown=guthwine:guthwine /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=guthwine:guthwine /app/node_modules/@prisma ./node_modules/@prisma

USER guthwine

ENV NODE_ENV=production

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/mcp/dist/index.js"]

# -----------------------------------------------------------------------------
# Stage 6: CLI
# -----------------------------------------------------------------------------
FROM node:20-alpine AS cli
WORKDIR /app

RUN apk add --no-cache dumb-init

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/cli/package.json ./packages/cli/
COPY --from=builder /app/package.json ./

ENTRYPOINT ["node", "packages/cli/dist/cli.js"]

# -----------------------------------------------------------------------------
# Stage 7: Database Migrations
# -----------------------------------------------------------------------------
FROM node:20-alpine AS migrations
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

WORKDIR /app/packages/database

ENTRYPOINT ["npx", "prisma"]
CMD ["migrate", "deploy"]
