# Getting started

This guide runs TaskBot locally: the bot, its REST API and MCP server, and the Mini App.

## Prerequisites

- Node.js **≥ 20**
- pnpm **10** (the version is pinned via `packageManager` in the root `package.json`; `corepack enable` picks it up)
- Docker, for local MongoDB and Redis
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

The repo is a **pnpm workspaces** + **Turborepo** monorepo:

| Package | Description |
|---------|-------------|
| [`apps/bot`](../apps/bot) | Telegraf bot + Express REST API + MCP server (MongoDB, Redis, Bull jobs) |
| [`apps/web`](../apps/web) | React + Vite + Tailwind Mini App (TanStack Router/Query) |
| [`packages/shared`](../packages/shared) | Shared TypeScript types and constants (`@tbot/shared`) |

## Run locally

```bash
# 1. Clone and install dependencies
git clone https://github.com/tun2g/taskbot.git
cd taskbot
pnpm install

# 2. Start MongoDB + Redis (Docker)
docker compose -f docker-compose.dev.yml up -d
#    Already have a Redis container on :6379? Start only Mongo:
#    docker compose -f docker-compose.dev.yml up -d mongodb

# 3. Configure env (see "Env files" below)
cp apps/bot/.env.example apps/bot/.env   # then set BOT_TOKEN
cp apps/web/.env.example apps/web/.env   # optional: VITE_BOT_USERNAME for browser login

# 4. Run everything
pnpm dev
```

| Service | URL |
|---------|-----|
| Bot + REST API + MCP | `http://localhost:3000` (polling mode unless `WEBHOOK_URL` is set) |
| Mini App | `http://localhost:5173` |

Then send `/start` to your bot in Telegram, add it to a group and try `/new Fix login on iOS @an`.

> The bot's dev server (nodemon) watches `src/` only. Changes to `.env` need a manual restart.

## Env files

Env files are **per app**. There is no combined root env file for local development.

- **`apps/bot/.env`** configures the bot and REST API, which run in one process. Start from
  [`apps/bot/.env.example`](../apps/bot/.env.example).
- **`apps/web/.env`** holds only `VITE_`-prefixed vars, baked in at build time. Start from
  [`apps/web/.env.example`](../apps/web/.env.example).

Each app documents its own variables in its `.env.example`. The production `docker-compose.yml` reads `apps/bot/.env`.
Every variable is described in [Configuration](configuration.md).

## Next steps

- [Configure BotFather](configuration.md#botfather-setup) so the bot can read group messages and open the Mini App inside Telegram.
- [Open the Mini App inside Telegram](telegram-mini-app.md) during development (it needs HTTPS, so use a tunnel).
- [Connect Claude Code or Cursor](mcp.md) through the MCP server.
- Learn the [bot commands](commands.md).
