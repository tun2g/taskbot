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
| `/new` | Create tasks — **groups only**. `/new <text> [@user]`, reply `/new` (`/new <note>`), reply `/new all`, `/new 10`. AI may split one message into several tasks |
| `/list` | List/filter tasks (`open`, `review`, `pending`, `done`, `bug`…, `@user`). Replying to a message offers "📝 Create tasks from that message" |
| `/mytasks` | Your open tasks (= `/list mine`) |
| `/update` | Change one task in plain words — reply `/update …` to its card or `/update #12 …` (status, assignee, priority, type, due date, title, description). Never creates tasks |
| `/ai` | Plain-language requests: assign, change status/priority/due, ask "what's on my plate?" |
| `/done` | Complete a task — `/done #123` or reply to a task card with `/done` |
| `/members` | Who can be assigned; members not listed tap "✋ I'm here" (bots can't list group members) |
| `/start` | In DM: your groups with buttons to open each board |
| `/help` | Interactive guide |
| `/settopic` | Admins, in a group with Topics: post task events (cards, status lines, digest) in this topic. Otherwise they go to a “Task events” topic the bot creates (needs admin + Manage topics) |

`/task`, `/create` and `/tasks` still work as hidden aliases (not in the menu; `/task` vs `/tasks` was easy to mix up).

Inline task cards support status transitions, priority and type pickers, an assignee picker (group members), and delete with confirmation (creator/admin only). Delete permission is enforced via `getChatMember`.

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
