FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS dependencies
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/bot/package.json ./apps/bot/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/bot/package.json ./apps/bot/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/bot/ ./apps/bot/
RUN pnpm --filter @tbot/shared build && pnpm --filter @tbot/bot build

FROM base AS production
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=builder /app/apps/bot/dist ./apps/bot/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/bot/package.json ./apps/bot/
COPY pnpm-workspace.yaml package.json ./
USER nodejs
EXPOSE 3000
CMD ["dumb-init", "node", "apps/bot/dist/index.js"]
