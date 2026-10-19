# @tbot/web

The TBot **Telegram Mini App** — a task board (list + Kanban) rendered inside Telegram.

## Stack

- **React 19** + **Vite** + **TypeScript**
- **Tailwind CSS v4**
- **TanStack Router** (file-based) + **TanStack Query** / React Query Kit
- **@telegram-apps/sdk-react** for Mini App integration
- **axios** API client
- **@dnd-kit/core** for board drag-and-drop

## Scripts

```bash
pnpm dev          # vite dev server (http://localhost:5173)
pnpm build        # tsc -b && vite build
pnpm preview      # preview production build
pnpm check-types  # tsc --noEmit
```

## Environment (`apps/web/.env`)

Only `VITE_`-prefixed vars reach the client.

```
# Absolute base URL of the bot REST API (routes live under /api). Defaults to /api
# (same origin / Vite dev proxy). Must be public HTTPS when the app runs inside Telegram.
VITE_API_URL=https://<api-host>/api

# The bot's username WITHOUT "@". Required for browser sign-in (Telegram Login Widget).
VITE_BOT_USERNAME=my_tbot
```

### Runtime config (Docker)

The image reads `API_URL` and `BOT_USERNAME` from the **container env** when it starts
(`docker/40-runtime-config.sh` writes them to `/config.js`, served with `no-store`).
They override the build-time `VITE_*` values, so the same image works for any bot or
domain — change the env and restart the container, no rebuild. Code reads the merged
values from `src/lib/runtime-config.ts`.

```bash
docker run -e API_URL=/api -e BOT_USERNAME=my_tbot ghcr.io/tun2g/taskbot-web
```

## Authentication

The app works in two places:

| Where | How requests are authenticated |
|---|---|
| Inside Telegram (Mini App) | `Authorization: tma <initData>` from `window.Telegram.WebApp.initData` — no sign-in screen |
| Normal browser | `/login` shows the **Telegram Login Widget** → `POST /api/auth/telegram-login` → token stored in `localStorage["tbot.token"]` → `Authorization: Bearer <token>` |

In the browser, any page without a token redirects to `/login?redirect=<page>`; a `401` clears the
token and does the same. After signing in you land back on the page you wanted.

**BotFather setup for browser login:** the Login Widget only works on a domain linked to the bot.
In [@BotFather](https://t.me/BotFather) run `/setdomain`, choose the bot, and enter the web app's
domain (e.g. `tasks.example.com`, or your ngrok host while testing). Without it the widget shows
"Bot domain invalid". If `VITE_BOT_USERNAME` is missing, `/login` shows a configuration message.

The API client also sends `ngrok-skip-browser-warning: true` so ngrok-free's interstitial doesn't corrupt XHR responses.

### Tunneling for Telegram

When testing inside Telegram, the page and the API both need public HTTPS URLs:

```bash
ngrok http 5173   # web  -> set bot WEBAPP_URL to this
ngrok http 3000   # api  -> set VITE_API_URL=https://<api-host>/api
```

`vite.config.ts` sets `server.allowedHosts: true` so tunneled hosts can reach the dev server.

## Architecture

`pages → container → content → components`

```
src/
  routes/              # TanStack Router (file-based)
    index.tsx          #   /                       your groups (or deep-link redirect)
    login.tsx          #   /login                  Telegram Login Widget (browser only)
    $groupId/tasks/    #   /$groupId/tasks         board (filters live in the URL search params)
                       #   /$groupId/tasks/$taskId task detail
  pages/               # groups, login, tasks, task-detail (.page -> .container -> .content + components)
  components/          # layout (header + Telegram BackButton), ui (badges, toast, skeleton, state), ai-chat (Ask AI)
  api/                 # TanStack Query hooks (auth, groups, tasks, ai)
  lib/                 # api-client, auth (token), telegram, user (displayName/getUserId), dates (due dates)
```

### Board

- **List | Board** views; the board groups by **Status** (default columns `TASK_BOARD_DEFAULT_STATUSES`,
  "Show all statuses" adds Backlog/Pending/Cancelled) or **Assignee** ("Show everyone" adds empty
  member columns).
- Drag-and-drop (`@dnd-kit/core`): mouse drags after 6px; on touch, press and hold ~200ms so normal
  swipes still scroll. Every card also has a ⋯ "Move to" menu, and the detail page has a status picker.
- Changes are optimistic and roll back with a toast if the API rejects them.
- Filters (search, assignee avatars, Type ▾ / Priority ▾ / Status ▾ (list only, status or status group), "Only my issues") are URL search
  params, so links and the back button keep them; list sort too. Loads up to 500 tasks; shows "Showing X of Y" beyond that.
- Colors use only `--tg-theme-*` tokens (lozenges are `color-mix()` tints of them), with browser fallbacks in `app.css`.

### Ask AI

A chat assistant on the board and task pages (`✨ Ask AI` in the header, or press `/`).

- Desktop (≥ 768px): a 400px right drawer that shifts the page so the board stays visible; Esc closes it.
  Mobile: a full-height bottom sheet (modal, focus-trapped, safe-area aware); Telegram's BackButton closes it.
- Opened from a task, a removable chip "About #12 · …" sends `taskId` ("this task"). Board filters are never sent.
- `POST /api/groups/:groupId/ai` (`useAiChat`) with the last 8 turns as `history`. Replies render as plain text
  (never HTML) plus rich parts: changed-task cards, task rows (→ detail, "View all on board"), created-task chips
  with a live **↩️ Undo** countdown (`POST /api/batches/:batchId/undo`, `useUndoBatch`), warnings and suggestion chips.
- `updated` / `created` replies and undos invalidate task list, detail, activity and stats queries, so the board
  updates live. Failed sends (429, network) keep the message with an inline Retry.
- The conversation is kept per group in `sessionStorage["tbot.aichat.<groupId>"]` (last 30 messages); "New chat" clears it.
- Starter chips are Vietnamese when `navigator.language` starts with `vi`, English otherwise.

### Due dates

A due date is a calendar day (`YYYY-MM-DD`). It's displayed with `timeZone: 'UTC'` so it never shifts,
and "Overdue" means the day is before *today in the group's timezone* (done/cancelled are never overdue).

### Deep links

Inside Telegram, `https://t.me/<bot>?startapp=<groupId>[_<taskId>]` opens the board or a task; `/`
consumes the start param once, so going back shows the groups list.

## Notes

- `@tbot/shared` is aliased to its **TS source** in `vite.config.ts` (the package's `dist` is CommonJS, which breaks ESM named imports under Vite).
- Theme: Telegram injects `--tg-theme-*` CSS variables; `app.css` defines light/dark fallbacks for browsers, and `dark:` follows Telegram's `colorScheme` (or the OS).
