# Deployment

TaskBot ships as two images: the **bot** (Telegram bot + REST API + MCP server, port 3000) and the **web** Mini App
(static files served by nginx).

## Docker Compose (bot + MongoDB + Redis)

The root [`Dockerfile`](../Dockerfile) builds and runs **the bot only**. [`docker-compose.yml`](../docker-compose.yml)
adds MongoDB and Redis on an internal network.

```bash
cp apps/bot/.env.example apps/bot/.env   # set BOT_TOKEN, and use compose hostnames:
                                         # REDIS_HOST=redis, MONGODB_URI=mongodb://mongodb:27017/tbot
docker compose up -d --build
```

## Mini App image

[`apps/web/Dockerfile`](../apps/web/Dockerfile) builds the Mini App and serves it with nginx. Build it from the repo
root:

```bash
docker build -f apps/web/Dockerfile -t taskbot-web .
docker run -p 8080:80 -e API_URL=https://api.example.com/api -e BOT_USERNAME=my_taskbot taskbot-web
```

`VITE_API_URL` (default `/api`, same origin) and `VITE_BOT_USERNAME` can be passed as build args. At startup the image
reads `API_URL` / `BOT_USERNAME` from the container env and writes them to `/config.js`, overriding the build-time
values, so one image works for any bot or domain.

## Prebuilt images

The GitHub Actions workflow [`.github/workflows/build.yml`](../.github/workflows/build.yml) builds both images on every
push to `main` and publishes them to GHCR:

- `ghcr.io/tun2g/taskbot-bot:latest` (also tagged `sha-<commit>`)
- `ghcr.io/tun2g/taskbot-web:latest` (also tagged `sha-<commit>`)

## Production checklist

- Serve the Mini App over **HTTPS** and set `WEBAPP_URL` to it.
- Route `/api` (and `/mcp`, for agents) to the bot on port 3000. Reverse-proxy snippets for `/mcp` (nginx, Caddy) are
  in [mcp.md](mcp.md#reverse-proxy).
- Set `WEBHOOK_URL` to use webhook mode (Telegram calls `<WEBHOOK_URL>/api/bot/webhook`); otherwise the bot polls.
- Complete the [BotFather setup](configuration.md#botfather-setup).
