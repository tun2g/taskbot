# Admin dashboard: static Vite build served by nginx. Build from the repo root:
#   docker build -f apps/admin/Dockerfile .
# The admin API is same-origin at /api (the reverse proxy routes it to apps/admin-api), so the
# image needs no runtime config.
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/admin/package.json ./apps/admin/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @tbot/admin...
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/admin/ ./apps/admin/
RUN pnpm --filter @tbot/shared build && pnpm --filter @tbot/admin build

FROM nginx:1.27-alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
