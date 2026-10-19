# @tbot/bot

Telegraf bot + Express REST API for TBot. Handles Telegram commands, inline task cards, the Mini App API, and scheduled jobs.

## Stack

- **Telegraf** — Telegram Bot API
- **Express** — REST API for the Mini App + webhook endpoint
- **Mongoose / MongoDB** — persistent data (tasks, users, groups, members)
- **Redis** — sessions, rate limiting, callback-data storage
- **Bull** — scheduled jobs (reminders, daily digest)
- AI provider abstraction (Gemini / Fuse)

## Scripts

```bash
pnpm dev          # nodemon (ts-node) with hot reload
pnpm build        # tsc + tsc-alias -> dist/
pnpm start        # node dist/index.js
pnpm check-types  # tsc --noEmit
pnpm test         # jest
```

> nodemon watches `src/` only — **changes to `.env` require a manual restart**.

## Environment

Create `apps/bot/.env` from [`.env.example`](.env.example):

```
NODE_ENV=development
BOT_TOKEN=<from @BotFather>
TELEGRAM_API_URL=https://api.telegram.org
WEBAPP_URL=http://localhost:5173      # HTTPS (e.g. ngrok) to enable the Mini App buttons
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DATABASE=0
MONGODB_URI=mongodb://localhost:27017/tbot
AI_PROVIDER=gemini
AI_API_KEY=
TIMEZONE=UTC
# WEBHOOK_URL=https://<public-host>   # optional: enables webhook mode
```

- No `WEBHOOK_URL` → **polling mode** (works locally without a public URL).
- `WEBHOOK_URL` set → registers a webhook at `/api/bot/webhook`.

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome + (in DM) an "Open Task Board" Mini App button |
| `/help` | List commands |
| `/task` | Create a task — **groups only** (reply to a message, or `/task <title> [@user]`) |
| `/tasks` | List/filter tasks (`mine`, `todo`, `in_progress`, `done`, `@user`) |
| `/done` | Complete a task — `/done #123` or reply to a task card with `/done` |
| `/settopic` | Admins, in a group with Topics: post task events (cards, status lines, digest) in this topic. Otherwise they go to a “Task events” topic the bot creates (needs admin + Manage topics) |

Inline task cards support status transitions, priority cycling, an assignee picker (group members), and delete (creator/admin only). Delete permission is enforced via `getChatMember`.

## REST API

Base path `/api`. All routes require Telegram `initData` auth (`Authorization: tma <initData>`), validated with `@telegram-apps/init-data-node`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check (no auth) |
| GET | `/api/groups` | User's groups |
| GET | `/api/groups/:groupId/tasks` | List tasks (filters) |
| POST | `/api/groups/:groupId/tasks` | Create task |
| GET | `/api/groups/:groupId/members` | Group members |
| GET | `/api/groups/:groupId/stats` | Task counts |
| GET | `/api/tasks/:taskId` | Single task |
| PATCH | `/api/tasks/:taskId` | Update task (syncs card to group) |
| DELETE | `/api/tasks/:taskId` | Delete task |

## Source layout

```
src/
  index.ts                 # bootstrap (DB, jobs, webhook/polling, server)
  server.ts                # Express app + CORS
  bot/                     # Telegraf: commands, middlewares, callback + card renderer
  api/                     # controllers, routes, middlewares, validation
  database/                # mongoose models + services
  jobs/                    # Bull job processors (reminder, digest)
  shared/services/         # redis, queue, notification, rate-limit, ai, telegram-api, ...
  configs/configuration.ts # env-backed config singleton
```

## Scheduled jobs (Bull)

- `due-reminder` — hourly; DMs assignee/creator for tasks due within 24h (once, via `reminderSent`).
- `daily-digest` — 09:00 UTC; posts a per-group task summary.

## Testing

```bash
pnpm test
```

Jest uses `jest.setup.ts` to inject test env vars (so the Redis/Mongo singletons construct cleanly without a live connection).
