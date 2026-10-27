# Landing page: static Vite build served by nginx. Build from the repo root:
#   docker build -f apps/landing/Dockerfile .
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/landing/package.json ./apps/landing/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @tbot/landing...
COPY tsconfig.base.json ./
COPY apps/landing/ ./apps/landing/
# Bot username (no "@") for the "Add to Telegram" buttons.
ARG VITE_BOT_USERNAME=
ENV VITE_BOT_USERNAME=$VITE_BOT_USERNAME
# Public URL for canonical / Open Graph tags and the sitemap. Empty = the vite.config default.
ARG VITE_SITE_URL=
ENV VITE_SITE_URL=$VITE_SITE_URL
RUN pnpm --filter @tbot/landing build

FROM nginx:1.27-alpine
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/landing/dist /usr/share/nginx/html
EXPOSE 80
