# Mini App: static Vite build served by nginx. Build from the repo root:
#   docker build -f apps/web/Dockerfile .
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @tbot/web...
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/
# Baked at build time. Default is same-origin: the reverse proxy routes /api to the bot.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# Bot username (no "@") for the browser Telegram login. Optional: BOT_USERNAME in the
# container env (runtime config) overrides it.
ARG VITE_BOT_USERNAME=
ENV VITE_BOT_USERNAME=$VITE_BOT_USERNAME
RUN pnpm --filter @tbot/shared build && pnpm --filter @tbot/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
# Runtime config: API_URL / BOT_USERNAME from the container env (e.g. envs/web.env) → /config.js
COPY --chmod=755 apps/web/docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
EXPOSE 80
