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
| `BOT_OWNER_TELEGRAM_ID` | Your numeric Telegram user id (ask [@userinfobot](https://t.me/userinfobot)). Turns on [group approval](#group-approval). **Empty = every new group is approved automatically** (the bot logs a warning at startup) |
| `OWNER_CONTACT` | Optional. How groups can reach you, e.g. `@yourname`. Added to the "not approved" notice (the bot has left, so it's the group's only way to ask) and the "paused" notice. Set the same value on the admin API |
| `ADMIN_URL` | Optional. Public URL of the admin app (same as the admin API's `ADMIN_PUBLIC_URL`). Your new-group cards and AI alert DMs then link to the group / AI page there |
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
| `AI_DAILY_LIMIT` | Fallback bot-wide cap on AI calls per day, for installs without the admin app. With the admin app, set limits on its **Settings** page instead (its daily call limit replaces this). Beyond the cap AI features fall back as if AI were unavailable. Empty or `0` = no cap. Per-user limits always apply: 6 `/ai` requests per minute per group and 100 AI requests per day across all groups, the app and MCP |
| `BOT_OWNER_TELEGRAM_ID` | Your numeric Telegram user id. The bot DMs you AI budget and usage-spike alerts (and admin notices) |
| `TIMEZONE` | Default group timezone for due dates, "overdue", reminders and the 9:00 daily digest. Default `UTC`, for example `Asia/Ho_Chi_Minh` |
| `WEB_AUTH_SECRET` | Optional key for browser-login tokens (Telegram Login Widget). Derived from `BOT_TOKEN` if unset; set it to rotate web sessions without changing the bot token |
| `NODE_ENV` | `development` / `production` |

MCP-specific settings and the reverse-proxy setup for `/mcp` are covered in [mcp.md](mcp.md#for-self-hosting).

### AI cost, usage stats and runtime settings

- **Every AI provider call is logged** (`ai_calls`): feature, model, tokens (input, cached, output incl. thinking),
  latency, status and an estimated cost. Retries and failures are separate rows; refusals by the daily cap are logged
  with status `quota`. Nothing from the prompt or answer is stored.
- **Cost** uses a built-in price table (USD per 1M tokens, `AI_BUILT_IN_PRICING` in `packages/shared`). Its prices
  are placeholders: verify them against your provider's pricing page and override or add models in the admin app
  (Settings → AI → pricing). A model with no price is logged with cost 0 and shown as "unknown", not free.
  Dated snapshots (`gpt-5-mini-2025-08-07`) use their family's price.
- **Runtime AI settings** (admin app, cached by the bot for 30 s) — the place to set limits: daily call limit
  (replaces the `AI_DAILY_LIMIT` fallback),
  per-person daily limit (default 100), daily budget in USD and the alert threshold (default 80%). Per group or
  person the owner can turn AI off (people get "AI is turned off for this group by the bot owner.") or set a
  daily limit, which replaces the group's 10-minute window (20 requests) or the person's daily default.
- **Budget alerts**: with a daily budget set and `BOT_OWNER_TELEGRAM_ID` configured, the hourly stats run DMs you
  once when today's spend reaches the alert threshold and once at 100% (the budget alerts only; AI keeps working
  until the daily call limit). It also warns once a day when a group makes more than 5× its usual daily AI calls
  (and over 30).
- **Usage events** (`usage_events`, kept 90 days): commands, button presses, AI mentions, Mini App API requests
  (route pattern only), MCP tool calls and rate-limit hits. A nightly job (00:10 UTC, then hourly for today)
  rolls them up into `stats_daily`, which the admin app reads.
- **History before tracking**: run `pnpm --filter @tbot/bot backfill:stats` once (in Docker:
  `node dist/scripts/backfill-stats.js`) to fill daily created / completed task counts from existing tasks. It
  only sets those two numbers, so days with real tracking keep their other stats. Safe to re-run.

## Mini App (`apps/web/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Bot REST API base URL, e.g. `http://localhost:3000/api`. In production the reverse proxy can serve it same-origin at `/api`. Must be public HTTPS when the app runs inside Telegram |
| `VITE_BOT_USERNAME` | Bot username **without** `@`, used by the Telegram Login Widget when the board is opened in a normal browser |

**Runtime config (Docker):** the web image also reads **`API_URL` / `BOT_USERNAME` from the container env at
startup** and writes them to `/config.js`. These override the build-time `VITE_*` values, so one image works for any
bot or domain without a rebuild. See [`apps/web/README.md`](../apps/web/README.md).

## Group approval

With `BOT_OWNER_TELEGRAM_ID` set, the bot only works in groups you approve:

1. Someone adds the bot to a group. The bot posts one "waiting for approval" note there and stays quiet.
2. You get a DM card (group name, who added the bot, member count, earlier decisions) with **✅ Approve** and
   **🚫 Reject**. Open a private chat with the bot and tap **Start** once, or the bot can't DM you — pending groups
   still show up in the admin app. Sending **/start** to the bot again re-sends the cards of every group still waiting.
3. Approve → the group gets a "ready" message (with an Open board button) and everything works. Reject → you pick a
   reason (Private bot / Not a team chat / No reason); the bot posts it in the group and leaves. With `OWNER_CONTACT`
   set, the notice also tells the group how to reach you. Deciding in the admin app posts exactly the same messages.

In groups with topics, these approval / pause / resume notices go to **General** (where everyone looks), not the
"Task events" topic; if General is closed to the bot they fall back to the events topic.

Until a group is approved (or while you have it suspended), commands get a short "waiting for approval" / "paused"
reply at most once every 6 hours, buttons (also the Done / Explain buttons on DM reminders) show an explanation, the Mini App shows the group as unavailable, MCP tools refuse
it, and no reminders or digests are sent. Removing the bot keeps the group's approval: adding it back restores it
(a rejected group asks again). When Telegram upgrades a group to a supergroup, its tasks move with it. A supergroup the bot has never seen
waits a few seconds before its "waiting for approval" note goes out, so an upgrade's first messages don't look like a
new group.

Groups that existed before approval was introduced are approved automatically.

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
