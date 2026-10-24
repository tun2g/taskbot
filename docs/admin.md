# Admin

The admin app lets the bot owner (one person) approve groups, watch usage and AI cost, and change AI limits.
It is two pieces: the web app (`apps/admin`) and the admin API (`apps/admin-api`). Both are separate from the
bot: their own process and container. They share only MongoDB, Redis and the `@tbot/db` / `@tbot/shared` packages.

## Admin API

`apps/admin-api` — Express 5, port `3001` by default, all routes under `/api`. It is meant to sit behind the same
reverse proxy as the admin web app (for example, Caddy serves the app at `https://admin-taskbot.example.com` and
proxies `/api/*` to `admin-api:3001`). The API sends no CORS headers: browsers can only call it from the same origin.

```bash
cp apps/admin-api/.env.example apps/admin-api/.env   # fill in the required values
pnpm --filter @tbot/shared build && pnpm --filter @tbot/db build
pnpm dev:admin-api
pnpm --filter @tbot/admin-api test
```

Docker: `docker build -f apps/admin-api/Dockerfile .` (CI publishes `ghcr.io/tun2g/taskbot-admin-api`).

### Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `BOT_OWNER_TELEGRAM_ID` | yes | Your numeric Telegram user id. The only person who can sign in. |
| `ADMIN_SESSION_SECRET` | yes | 32+ random characters (`openssl rand -hex 32`). Login codes and session ids are stored in Redis only as an HMAC with this key. Changing it signs everyone out. |
| `ADMIN_PUBLIC_URL` | yes | Public URL of the admin app. Login links point to `<ADMIN_PUBLIC_URL>/login/callback?code=…`. In production its origin is also the only `Origin` the API accepts on changes. |
| `BOT_TOKEN` | yes | The bot's token. The API uses it to DM login links and post approval notices with plain Bot API calls. It never polls and never receives updates. |
| `MONGODB_URI`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_DATABASE` | yes | Same values as the bot. |
| `ADMIN_API_PORT` | no | Default `3001`. |
| `TELEGRAM_API_URL` | no | Default `https://api.telegram.org`. |
| `WEBAPP_URL` | no | Same as the bot. Approving a group posts the same "approved" message as approving from Telegram, with an **📋 Open board** button: `t.me/<bot>?startapp=<group>` when the bot has a Main Mini App (read from `getMe`), else `<WEBAPP_URL>/<group>/tasks` (https only). Neither available = no button. |
| `OWNER_CONTACT` | no | Same as the bot, e.g. `@yourname`. The "not approved" and "paused" notices tell the group to message you there. Unset = that line is left out. |
| `NODE_ENV` | no | `development` drops the cookie's `Secure` flag and the `Origin` check, so a Vite dev server works. |

The server refuses to start, and names each missing value, if a required variable is missing or invalid.

The admin API has no AI variables. AI limits are set on the **Settings** page; the bot's `AI_DAILY_LIMIT` is only a
fallback for installs without the admin app. The bot reports its provider, model, `AI_DAILY_LIMIT` and start time to
MongoDB on every start (`settings` document `runtime`), and the admin app reads them from there — so the Settings
page shows the model the bot really runs, and System shows "Bot started … ago".

### Sign-in flow

1. The app calls `POST /api/auth/request-link`. There is no identity input: the link always goes to
   `BOT_OWNER_TELEGRAM_ID`. The API creates a random one-time code (32 bytes). It stores only an HMAC-SHA256 of the
   code in Redis, with a 5-minute TTL. Then it DMs the owner an **Open admin** button linking to `/login/callback?code=…`.
   You must have started a private chat with the bot first, or Telegram refuses the DM. The API then answers `502`.
   The response carries a separate `requestId`. The waiting page polls `GET /api/auth/link-status?requestId=` (→
   `unused` / `used` / `expired`) only to say "That link was used in another browser". It never signs that browser
   in: the link logs in whichever browser opens it.
2. The callback page calls `POST /api/auth/exchange { code }`. The code can be used once (atomic `GETDEL`). On
   success the API creates a 12-hour session in Redis and sets the cookie `tbot_admin` (`HttpOnly`, `Secure`,
   `SameSite=Strict`, `Path=/api`). The session records the browser (user agent), the client IP, when it was created
   and when it was last used. The bot DMs the owner "New sign-in to TaskBot admin: Safari on iPhone · 1.2.3.4 · …".
3. Every other route checks for a live session whose Telegram id equals the **current** `BOT_OWNER_TELEGRAM_ID`. If
   you change the owner id, existing sessions stop working and are deleted.
4. `POST /api/auth/logout` ends this session. `POST /api/auth/logout-all` ends every session.
   `GET /api/auth/sessions` lists the signed-in browsers (account menu → **Active sessions**) and
   `POST /api/auth/sessions/:id/revoke` signs out one of them.

Sign-ins (with browser and IP), log-outs, signing out another browser and "sign out everywhere" are recorded in the
audit log.

### Security notes

- **Rate limits** (Redis, fixed window): login links are limited to 5 per IP per 15 minutes and 20 per hour for the
  whole server. Code exchanges are limited to 20 per IP per 15 minutes. `trust proxy` is set to 1 hop, so the client
  IP is read from `X-Forwarded-For`. Keep exactly one proxy in front of the API.
- **CSRF**: the cookie is `SameSite=Strict`. In addition, every `POST`/`PUT`/`PATCH`/`DELETE` must send
  `Content-Type: application/json`, or the API answers `415`. HTML forms can't send that type, and a cross-site
  `fetch` with it needs a CORS preflight, which this API never answers. Outside development, a request with an
  `Origin` header other than `ADMIN_PUBLIC_URL`'s origin is refused with `403`.
- **Privacy**: responses contain numbers and the names of groups and people. The one exception is
  `GET /groups/:id/tasks`, the read-only list behind a group's task numbers: it returns task titles (plus status,
  assignee, dates and where the task was created). Descriptions and message text are never returned.
- **Audit log**: every change is written to `admin_audit_logs` (action, target name snapshot, reason, details such as
  before/after values or deleted counts, IP). The IP is not returned by the API.
- The API sets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: no-referrer`. The JSON body limit is 32 kB.

### Conventions for the frontend

- Responses are `{ data }` or `{ data, meta: { page, limit, total, hasMore } }`. Errors are
  `{ error, message, statusCode }`, and `message` is a plain sentence you can show as-is.
- `401`: no or expired session. Send the person to the login page.
- `409`: the action doesn't fit the group's current status (for example, "This group is already active."). Show the
  message and reload the group.
- `400`: validation (for example, a missing reason for reject/suspend, or a delete `confirmName` that doesn't
  exactly match the group name). `429`: rate limited (the message says when to retry). `502`: Telegram refused the
  login DM.
- Group actions return the updated `AdminGroupRow` plus `warnings: string[]`. A failed Telegram side effect (notice,
  owner DM card update, `leaveChat`) does **not** undo the decision. It shows up as a warning to display.
- AI overrides (`PATCH /groups/:id/ai`, `PATCH /users/:id/ai`) and `PUT /settings/ai` return
  `appliesWithinSeconds: 30`, because the bot caches these settings for up to 30 seconds.

### Endpoints

| Method & path | Notes |
| --- | --- |
| `GET /api/health` | No auth. |
| `POST /api/auth/request-link` | → `AdminLoginLinkResponse` |
| `POST /api/auth/exchange` `{ code }` | → `AdminSession` and sets the cookie |
| `POST /api/auth/logout`, `POST /api/auth/logout-all` | |
| `GET /api/auth/me` | → `AdminSession` |
| `GET /api/overview?range=7d\|30d\|90d` | → `AdminOverview`, with `attention` (see "Needs attention" below; left out if it can't be computed) |
| `GET /api/groups?status=&q=&sort=lastActivity\|aiCost\|tasks\|members\|added&activeIn=7d\|30d\|90d&page=&limit=` | `status` may be a comma-separated list. `q` matches the name or Telegram chat id. `activeIn` keeps the groups behind the overview's "Groups with activity" (same rule and window) and adds `inPeriod` numbers (AI cost and unpriced calls for that period); with it, the default sort is requests in the period and `sort=tasks` is tasks created in the period. Pending rows carry `previousDecision` (last reject / suspend / remove from the audit log). |
| `GET /api/groups/:id?range=` | → `AdminGroupDetail` (Telegram member count and public link refreshed best-effort). Moved groups carry `migratedTo` (the group that continues them); bot-removed groups carry `statusBeforeLeft` (what a re-add restores). |
| `GET /api/groups/:id/members?range=&q=&sort=lastActive\|events\|aiCalls\|aiCost\|tasks\|tokens\|joined&page=&limit=` | Paginated `AdminGroupMemberRow`s (everyone, no cap). `q` matches name, @username or Telegram id. |
| `GET /api/groups/:id/tasks?filter=open\|overdue\|done\|all&createdIn=7d\|30d\|90d&q=&page=&limit=` | Paginated `AdminGroupTaskRow`s plus `counts` per filter. Read-only; titles only. |
| `GET /api/groups/:id/epics?page=&limit=` | Paginated `AdminGroupEpicRow`s (open first) with task counts. |
| `GET /api/groups/:id/delete-preview` | → `AdminGroupDeletePreview` |
| `DELETE /api/groups/:id` `{ confirmName }` | The bot leaves the chat (best effort), then the group's data is deleted. Usage and AI cost rows are kept. |
| `POST /api/groups/:id/approve` `{ notifyGroup? }` | pending → active. A rejected group can't be approved (the bot left the chat); adding the bot again makes it pending. |
| `POST /api/groups/:id/reject` `{ reason, notifyGroup? }` | pending → rejected. The reason is required and shown to the group. The bot then leaves. |
| `POST /api/groups/:id/suspend` `{ reason, notifyGroup? }` | active/pending → suspended. The reason is required. |
| `POST /api/groups/:id/unsuspend` `{ notifyGroup? }` | suspended → active |
| `POST /api/groups/:id/leave` `{ reason?, notifyGroup? }` | The bot says goodbye and leaves. The status becomes `left`, and the previous status is kept so a re-add restores it. |
| `POST /api/groups/:id/reconsider` `{}` | rejected → `left` with no decision kept: nothing is sent to Telegram, the rejection reason is cleared, and the next time someone adds the bot the group waits for approval again (never auto-approved). Audited as `group.reconsider`. |
| `PATCH /api/groups/:id/ai` `{ disabled?, dailyLimit? }` | |
| `GET /api/users?q=&sort=lastSeen\|aiCost\|aiCalls\|events\|tokens&activeIn=today\|7d\|30d&hasTokens=1&page=&limit=` | `activeIn` = people with a usage event in that window — the people behind DAU / WAU / MAU. `hasTokens=1` = people holding an active MCP token (the people behind MCP "Active tokens"). |
| `GET /api/users/:id?range=` | → `AdminUserDetail` |
| `PATCH /api/users/:id/ai` `{ disabled?, dailyLimit? }` | |
| `POST /api/users/:id/revoke-tokens` | Revokes all of the person's MCP tokens (effective immediately) → `{ revoked }` |
| `GET /api/ai/usage?range=&groupBy=day\|feature\|model\|group\|user&groupId=&userId=` | → `AdminAiUsage` |
| `GET /api/ai/calls?status=&feature=&groupId=&userId=&model=&range=&page=&limit=` | → paginated `AdminAiCallRow` |
| `GET /api/settings/ai`, `PUT /api/settings/ai` `{ …, restoredFrom? }` | → `AdminAiSettings` (with `lastChangedAt`; `defaults` = what the bot reported on startup). `restoredFrom` = an audit entry id when restoring the values from before that change (audited as `settings.ai.restore`). |
| `GET /api/mcp?range=&tool=&client=` | → `AdminMcpOverview`. `tool` / `client` narrow every call number (calls, failures, per person / group / day) to one tool or client (`client=Unknown client` = calls with no client name); token numbers always cover everyone. Also returns `byGroup`, `rateLimitedBy` and the active `tokens` (max 100). |
| `GET /api/system` | → `AdminSystemStatus` (Mongo/Redis ping, Bull queue `task-management` counts and repeating jobs — one row per schedule with last success, failures in 24 h and next run; `activity` = requests in the last hour vs the average for the same hour over the previous 7 days; `lastEventByChannel`) |
| `GET /api/system/jobs/failures?name=&cron=` | → `AdminJobFailures`: the failed runs (last 24 h) of one schedule with time, error and attempt, plus its next run. |
| `POST /api/system/jobs/run` `{ name, cron }` | Queues one run of a job the bot has scheduled (same input as its scheduled runs); the bot runs it within seconds. Audited. |
| `GET /api/audit-log?page=&limit=&targetType=&targetId=` | → paginated `AdminAuditEntry`, with `changes` (plain lines such as "Daily call limit: 500 → 200") and `targetMissing` when the group / person was deleted since. |

### Where the numbers come from

- Daily series and period totals use `stats_daily` (written by the bot's rollup) up to yesterday. Today, and any day
  after the newest rollup, is computed live from `usage_events`, `ai_calls` and `tasks`. Before the first rollup,
  everything is live.
- DAU / WAU / MAU are distinct people in `usage_events` over today / the last 7 days / the last 30 days.
  `trackingSince` is the first day with any usage or AI tracking. Numbers before it are not tracked.
- Group members' `lastActiveHereAt` is their latest usage event in that group (90 days); `lastSeenAt` is anywhere.
- The bot keeps the last 200 completed and 200 failed jobs in the queue (`removeOnComplete` / `removeOnFail`), which is
  what "last run", "last success" and "failures in 24 h" on the System page read.
- Per-group and per-person 30-day AI numbers, AI breakdowns and AI call lists read `ai_calls` directly (kept
  forever). MCP and per-person activity read `usage_events` (kept 90 days, the longest range).

### Needs attention (overview)

`AdminOverview.attention` lists what the owner should act on, danger first; an empty list renders as "All clear".
Today = since 00:00 UTC; the norm = the previous 7 days from `stats_daily` (MCP: from `usage_events`).

| kind | Shown when | Links to |
| --- | --- | --- |
| `failed_jobs` | A scheduled job's latest run failed, or the queue (Redis) can't be read (danger) | `/system` |
| `refused` | Any AI request refused by a daily AI limit (`quota`) or ≥ 20 rate-limited requests today. Danger when the global daily call limit is used up (AI stopped for everyone until midnight UTC). Owner-disabled AI (`disabled`) is not an anomaly. | `/ai?status=quota`, else `/mcp` or the group with the most |
| `ai_failures` | ≥ 10 provider calls today, (failed + invalid) / provider calls ≥ 10 % and ≥ 2× the 7-day norm. Danger from 30 %. | `/ai?status=failed` (or `invalid`) |
| `ai_spike` | A group's AI calls today > 5× its 7-day daily average and > 30 (same rule as the bot's Telegram alert); max 3 | `/ai?groupId=` |
| `mcp_errors` | Same rate rule as AI failures, on MCP tool calls | `/mcp` |
| `pending_groups` | A group has waited for approval for over 24 h | `/groups?status=pending` |

Rules live in `apps/admin-api/src/stats/attention.ts` (`buildAttention`, unit-tested); the mock adapter mirrors them.
Job and MCP tool names are explained by `BACKGROUND_JOBS` / `MCP_TOOLS` in `@tbot/shared`, used by both apps.

## Admin web app

`apps/admin` is a React 19 + Vite + Tailwind v4 single-page app (TanStack Router file routes, TanStack Query,
Recharts). Only the bot owner can log in.

### How it talks to the API

- Same-origin `/api` (in dev Vite proxies `/api` → `http://localhost:3001`; in production the reverse proxy in
  front of `admin-taskbot.chamees.site` routes `/api` to `apps/admin-api`). No runtime config is needed.
- Auth is an httpOnly session cookie (`Path=/api`, `SameSite=Strict`). Requests send credentials; mutations send
  `Content-Type: application/json` and `X-Requested-With: tbot-admin`.
- Types are the contract in `packages/shared/src/types/admin.ts`.
- `401` → `/login?redirect=<where you were>`; `409` → the server's message as a toast and a refetch; a mutation
  response's optional `warnings: string[]` is shown as a warning toast.

Endpoints the app calls that the contract file doesn't spell out (the API should provide them):

| Call | Used for |
| --- | --- |
| `GET /auth/session` → `ApiResponse<AdminSession>` (401 when logged out) | Route guard and the account menu |
| `POST /auth/logout`, `POST /auth/logout-all` | Account menu: "Log out" / "Log out everywhere" |
| `POST /users/:id/revoke-tokens` → `ApiResponse<{ revoked: number }>` | "Revoke all MCP tokens" on a person |
| `range` query param on `GET /ai/calls` | So the calls list matches the totals it drills down from |

Prices in `AdminAiSettings.pricing` / `builtInPricing` are shown as **USD per 1M tokens**.

### Pages and the API calls they make

| Route | Calls |
| --- | --- |
| `/login` | `POST /auth/request-link` (resend has a 30 s cooldown) |
| `/login/callback?code=` | `POST /auth/exchange { code }`, then back to the page you came from (kept in `localStorage`, since the link opens in a new tab) |
| `/` Overview | `GET /overview?range=`; inline Approve/Reject → `POST /groups/:id/approve|reject` |
| `/groups` | `GET /groups?status=&q=&sort=&page=&limit=20`, `GET /overview?range=` (tab counts); row actions below |
| `/groups/$groupId` | `GET /groups/:id?range=`, `GET /overview?range=` (trackingSince), `GET /settings/ai` (the limits that apply without an override), Tasks tab: `GET /groups/:id/tasks`, `GET /groups/:id/epics`; People tab: `GET /groups/:id/members`; `PATCH /groups/:id/ai`, lifecycle: `POST /groups/:id/{approve,reject,suspend,unsuspend,leave,reconsider}`, `GET /groups/:id/delete-preview`, `DELETE /groups/:id { confirmName }` |
| `/users` | `GET /users?q=&sort=&activeIn=&hasTokens=&page=&limit=20` |
| `/users/$userId` | `GET /users/:id?range=`, `GET /overview?range=`, `GET /settings/ai` (default limit text), `PATCH /users/:id/ai`, `POST /users/:id/revoke-tokens` |
| `/ai` | `GET /ai/usage?range=&groupBy=&groupId=&userId=` (+ `groupBy=day` for the charts), `GET /ai/calls?range=&status=&feature=&groupId=&userId=&page=&limit=25`, `GET /groups/:id` / `GET /users/:id` to label filter chips |
| `/mcp` | `GET /mcp?range=&tool=&client=`, `GET /overview?range=` |
| `/system` | `GET /system` (every 30 s) |
| `/audit-log` | `GET /audit-log?targetType=&targetId=&page=&limit=25` |
| `/settings` | `GET /settings/ai`, `PUT /settings/ai` (`pricing` = your overrides only) |
| Sidebar badge | `GET /groups?status=pending&limit=1` (`meta.total`) |

The date range (`7d` / `30d` / `90d`), tabs, filters and pages live in the URL, so every view can be linked.
Every aggregate drills down: KPI cards open the page that explains them, and every cost opens `/ai` filtered to
the calls behind it.

### Run it

```bash
pnpm install
pnpm --filter @tbot/shared build
pnpm dev:admin                              # http://localhost:5174, API expected on :3001
pnpm --filter @tbot/admin dev:mock          # no API needed: fixture data from src/mocks
pnpm --filter @tbot/admin build
```

**Mock mode** (`VITE_ADMIN_MOCK=1`, dev only) swaps the HTTP adapter for in-memory fixtures — groups in every
status (three waiting for approval), a group with unpriced AI calls, tracking that started 12 days ago — so the
whole UI can be clicked through. Actions change the in-memory data until reload. On the login page, mock mode adds
links to open a valid or an expired login link. The fixtures are loaded with a dynamic import behind
`import.meta.env.DEV`, so production builds don't contain them.

### Deploy

`apps/admin/Dockerfile` builds the static app and serves it with nginx (SPA fallback, immutable `/assets/`,
`noindex`). Build from the repo root: `docker build -f apps/admin/Dockerfile .`. CI publishes
`ghcr.io/tun2g/taskbot-admin`. Route `admin-taskbot.chamees.site/api` to the admin API and everything else to
this container.
