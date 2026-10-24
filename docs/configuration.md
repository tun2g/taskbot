# Configuration

Env files are **per app**:

- **`apps/bot/.env`** configures the bot, REST API and MCP server (one process). Template:
  [`apps/bot/.env.example`](../apps/bot/.env.example). The production `docker-compose.yml` reads this file too.
- **`apps/web/.env`** holds only `VITE_`-prefixed vars, baked in at build time. Template:
  [`apps/web/.env.example`](../apps/web/.env.example).

## Bot (`apps/bot/.env`)

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | From [@BotFather](https://t.me/BotFather). **Required.** |
| `TELEGRAM_API_URL` | Telegram Bot API base URL. Default `https://api.telegram.org` |
| `BOT_USERNAME` | Optional. The bot reads its username from `getMe` at startup |
| `WEBAPP_URL` | Mini App URL. **Must be HTTPS** for the menu button and deep links. Also the allowed CORS origin |
| `WEBHOOK_URL` | If set, the bot uses webhook mode (Telegram calls `<WEBHOOK_URL>/api/bot/webhook`). If unset, it uses polling |
| `PORT` | HTTP port. Default `3000` |
| `MCP_PUBLIC_URL` | Optional public URL of the MCP endpoint (shown by `/mcp` and the tokens page). Defaults to `<WEBHOOK_URL>/mcp` |
| `MONGODB_URI` | `mongodb://localhost:27017/tbot` locally, `mongodb://mongodb:27017/tbot` in compose |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DATABASE` | `localhost` / `6379` / `0` locally. Use `redis` as the host in compose |
| `AI_PROVIDER` | `gemini` (default), `openai` or `fuse`. Powers `/new` extraction, `/ai`, `/update` and the web "Ask AI" chat |
| `AI_API_KEY` | Provider API key. Without a key, `/new` still creates a basic task and `/ai` explains that AI is unavailable |
| `AI_MODEL` | Model id. Defaults to `gemini-3.5-flash-lite` (gemini) or `gpt-5-mini` (openai) |
| `AI_API_URL` | For `openai` / `fuse`: base URL of any OpenAI-compatible endpoint (OpenRouter, Groq, vLLM, Ollama, ...). Empty means the provider default (`https://api.openai.com/v1`, `https://api.fuseapi.app/v1`). Ignored by `gemini` |
| `AI_DAILY_LIMIT` | Optional bot-wide cap on AI calls per day (a cost circuit breaker). Beyond it AI features fall back as if AI were unavailable. Empty or `0` = no cap. Per-user limits always apply: 6 `/ai` requests per minute per group and 100 AI requests per day across all groups, the app and MCP |
| `TIMEZONE` | Default group timezone for due dates, "overdue", reminders and the 9:00 daily digest. Default `UTC`, for example `Asia/Ho_Chi_Minh` |
| `WEB_AUTH_SECRET` | Optional key for browser-login tokens (Telegram Login Widget). Derived from `BOT_TOKEN` if unset; set it to rotate web sessions without changing the bot token |
| `NODE_ENV` | `development` / `production` |

MCP-specific settings and the reverse-proxy setup for `/mcp` are covered in [mcp.md](mcp.md#for-self-hosting).

## Mini App (`apps/web/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Bot REST API base URL, e.g. `http://localhost:3000/api`. In production the reverse proxy can serve it same-origin at `/api`. Must be public HTTPS when the app runs inside Telegram |
| `VITE_BOT_USERNAME` | Bot username **without** `@`, used by the Telegram Login Widget when the board is opened in a normal browser |

**Runtime config (Docker):** the web image also reads **`API_URL` / `BOT_USERNAME` from the container env at
startup** and writes them to `/config.js`. These override the build-time `VITE_*` values, so one image works for any
bot or domain without a rebuild. See [`apps/web/README.md`](../apps/web/README.md).

## BotFather setup

| Setting | Why |
|---------|-----|
| `/setprivacy` → **Disable** (then re-add the bot to groups) | Lets the bot read group messages, so `/new 10` and `/new all` can turn recent messages into tasks |
| Main Mini App (Bot Settings → Configure Mini App) | Enables in-Telegram "Open board" links from groups and DMs (`t.me/<bot>?startapp=…`). Without it, links open the browser version |
| `/setdomain` → your web domain | Required for the Telegram Login Widget (opening the board in a normal browser) |
| Make the bot a group **admin** (optional) | Telegram only sends member join/leave updates to admins, which keeps the assignee list accurate. With the *Manage topics* right, the bot can also create its "Task events" topic in forum groups |

More on launch points and why the Main Mini App matters: [telegram-mini-app.md](telegram-mini-app.md).

## Group setup tips

- In groups with several bots, pick commands from the menu so they go to TaskBot.
- In forum groups (Topics), task events go to a "Task events" topic. The bot creates it if it is an admin with
  *Manage topics*; otherwise run `/settopic` in the topic you want.
- Telegram doesn't let bots list members. The bot learns people when they post, are replied to or are tagged. Send
  `/members` so everyone can tap ✋ once.
- To receive DMs (assignments, reminders), each person opens a private chat with the bot once and taps **Start**.
