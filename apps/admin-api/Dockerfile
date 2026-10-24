# Admin API image. Build from the repo root: docker build -f apps/admin-api/Dockerfile .
FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS dependencies
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/admin-api/package.json ./apps/admin-api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/admin-api/package.json ./apps/admin-api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/db/ ./packages/db/
COPY apps/admin-api/ ./apps/admin-api/
RUN pnpm --filter @tbot/shared build && pnpm --filter @tbot/db build && pnpm --filter @tbot/admin-api build

FROM base AS production
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/admin-api/node_modules ./apps/admin-api/node_modules
COPY --from=dependencies /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/apps/admin-api/dist ./apps/admin-api/dist
COPY --from=builder /app/apps/admin-api/package.json ./apps/admin-api/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY pnpm-workspace.yaml package.json ./
# @tbot/db has mongoose as a peer dependency (not installed by --prod): point it at the app's mongoose so both
# share ONE instance (models registered by @tbot/db must live on the connection the app opens).
RUN mkdir -p packages/db/node_modules && ln -sfn /app/apps/admin-api/node_modules/mongoose packages/db/node_modules/mongoose
USER nodejs
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["dumb-init", "node", "apps/admin-api/dist/index.js"]
