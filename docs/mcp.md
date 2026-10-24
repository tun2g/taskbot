# TaskBot MCP server — Claude Code, Cursor & other AI agents

TaskBot exposes a remote [MCP](https://modelcontextprotocol.io) server at **`/mcp`** so coding agents can work with
your team's tasks without leaving the editor.

It is **agent-to-agent**: your agent (Claude Code, Cursor, …) can simply *talk* to TaskBot's own AI assistant with
`ask_taskbot` — the same assistant as `/ai` in Telegram, in Vietnamese or English — and it also gets precise,
structured tools (`list_tasks`, `create_tasks`, `update_task`, …) for when it already knows the exact fields.

Everything an agent does looks exactly like a change made in the app: it is written to the task's history
(`via mcp`), the group sees one short line or card — `(via Claude Code)` / `(via Cursor)` — and assignees get their DM.

---

## For users

### 1. Get a token

- **Telegram:** send **`/mcp`** to the bot in a private chat, pick a group (or *🌐 All my groups*), and copy the reply.
  Sending `/mcp` *in a group* creates a token for that group and DMs it to you (the secret is never posted in the group).
- **Mini App:** *🤖 AI tools* page (`/settings/tokens`) — create, see last use, revoke.

Tokens look like `tbot_…`. They are **shown once** — treat them like a password.

#### Token scopes

| Scope | What the agent can reach | `group` argument |
|-------|--------------------------|------------------|
| **One group** (recommended) | only that group | optional everywhere (always that group); another group is refused |
| **All my groups** | every group you are a member of | group id **or title**; optional if you are in exactly one group, otherwise the agent must say which (or ask you) |

Tip: one group-scoped token per repository/project keeps agents from touching the wrong team's board.

### 2. Connect your agent

The URL is shown in the `/mcp` reply (e.g. `https://taskbot.example.com/mcp`).

#### Claude Code

```bash
claude mcp add --transport http taskbot https://taskbot.example.com/mcp \
  --header "Authorization: Bearer tbot_…"
```

- Add `--scope user` (all your projects) or `--scope project` (writes `.mcp.json` in the repo). The default is `local`
  (only you, only this project).
- Check it: run **`/mcp`** inside Claude Code — `taskbot` should be *connected*.

**Project `.mcp.json` without committing the secret** — Claude Code expands environment variables:

```json
{
  "mcpServers": {
    "taskbot": {
      "type": "http",
      "url": "https://taskbot.example.com/mcp",
      "headers": { "Authorization": "Bearer ${TBOT_TOKEN}" }
    }
  }
}
```

Then `export TBOT_TOKEN=tbot_…` in your shell profile. **Never commit a real token.**

#### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (this project):

```json
{
  "mcpServers": {
    "taskbot": {
      "url": "https://taskbot.example.com/mcp",
      "headers": { "Authorization": "Bearer tbot_…" }
    }
  }
}
```

Cursor also interpolates environment variables — use `"Authorization": "Bearer ${env:TBOT_TOKEN}"` in a
project file you commit.

#### Other MCP clients

Any client that supports **Streamable HTTP** works: `POST https://…/mcp` with header
`Authorization: Bearer tbot_…`. The server is stateless (JSON responses, no session id, `GET`/`DELETE` → 405).

### 3. Ask

- “tạo 3 task cho epic Login giao @an hạn thứ 6” → `ask_taskbot` creates them (one summary in the group, undoable 10 min)
- “task nào của tôi quá hạn?” / “what's overdue in Team Alpha?”
- “giải thích #12” — what a task is about, from its description and source messages
- Follow-ups keep context: the reply contains a `conversationId`; “giao nó cho @binh” with the same id refers to the
  previous task. When TaskBot asks a clarifying question, the agent answers with the same `conversationId`.

### Tool reference

| Tool | Purpose | Key params | Kind |
|------|---------|-----------|------|
| `ask_taskbot` | Natural-language request to TaskBot's AI (create, update, explain, query, epics; may ask back) | `message`, `group?`, `conversationId?`, `taskNumber?` | write |
| `list_groups` | Your groups (or the token's group) + open task counts | — | read-only |
| `list_members` | People tasks can be assigned to | `group?` | read-only |
| `list_tasks` | Board list with filters, paginated (open tasks by default) | `status`, `category`, `assignee` (`me`/`none`/@user), `epic`, `type`, `priority`, `due` (overdue/today/week/none), `search`, `page`, `limit ≤ 50`, `includeClosed` | read-only |
| `get_task` | One task: description, epic, source chat messages, last 10 history entries | `taskNumber` | read-only |
| `create_tasks` | 1–20 tasks; one group post; returns `undoToken` | `tasks[{title, description?, type?, priority?, assignee?, dueDate?, epic?}]` | write |
| `update_task` | Change fields; `null` clears assignee / due date / epic | `taskNumber`, fields | write (idempotent) |
| `delete_task` | Delete (creator or group admin only) — prefer status `cancelled` | `taskNumber` | **destructive** |
| `undo_last` | Remove a batch created by `create_tasks` / `ask_taskbot` (10 min) | `undoToken` | destructive |
| `list_epics` | Epics with progress | — | read-only |
| `create_epic` | New epic (unique title per group) | `title`, `description?`, `color?` | write |
| `update_epic` | Rename / recolor / close (`done`) / reopen | `epic` (title or id), fields | write (idempotent) |

Tasks are referenced by number within the group (`#12` → `taskNumber: 12`); people by `@username`, name or `me`;
epics by title (case-insensitive) or id. Errors are written for the agent: unknown names come back with close matches.

### Limits

- **120 MCP requests / minute per token, 240 / minute per user across all their tokens** (HTTP 429 + `Retry-After` beyond that).
- `ask_taskbot` shares the `/ai` limits: 6 requests / minute per person per group, 20 AI requests / 10 minutes per group, and 100 AI requests / day per person across all groups, the app and MCP.
- At most **10 active tokens** per person.

### Revoking

Mini App → *🤖 AI tools* → revoke. It stops working immediately. A lost or leaked token: revoke it and send `/mcp` again.

### Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| **401** “Unknown / revoked / expired access token” | typo, revoked or old token → create a new one with `/mcp`. `WWW-Authenticate` says which. |
| **401** “not a TaskBot access token” | the header must be `Authorization: Bearer tbot_…` (web-login tokens don't work here) |
| **403** “limited to a group you're no longer a member of” | a group-scoped token whose group you left (or that was removed) → new token |
| Tool error “You don't have access to that group” | wrong group id/title, or you aren't a member → `list_groups` |
| Tool error “This token only works for group X” | group-scoped token used for another group → use an all-groups token |
| **429** | rate limit — wait `Retry-After` seconds |
| `ask_taskbot` “AI is unavailable” | the server has no AI key, or the AI is down/busy → use the structured tools |
| `list_groups` is empty / “No group member matches …” | the bot only knows people who posted in the group, were mentioned, or tapped ✋ under `/members` there |

---

## For self-hosting

- The MCP server runs **inside the bot process/container** (Express, port `3000`) at `/mcp` — no extra service.
- Public URL = **`MCP_PUBLIC_URL`** if set, else **`<WEBHOOK_URL>/mcp`**. Without either, `/mcp` in Telegram replies
  with an admin-facing message and issues no token (the Mini App falls back to the API's own host).
- Implementation: official `@modelcontextprotocol/sdk`, Streamable HTTP in stateless JSON mode (one server per request).

### Environment

| Var | Notes |
|-----|-------|
| `MCP_PUBLIC_URL` | full public URL of the endpoint, e.g. `https://api.example.com/mcp` (optional) |
| `WEBHOOK_URL` | used as `<WEBHOOK_URL>/mcp` when `MCP_PUBLIC_URL` is empty |
| `WEBAPP_URL` | https Mini App URL — enables the *🔑 Manage tokens* buttons |

### Reverse proxy

Forward `/mcp` to the bot with buffering off (responses are JSON today, but this keeps SSE-capable clients happy):

```nginx
location /mcp {
  proxy_pass http://tbot:3000;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;
  proxy_read_timeout 300s;
}
```

```caddy
reverse_proxy /mcp* tbot:3000 {
  flush_interval -1
}
```

### Security notes

- Only the **SHA-256 hash** of a token is stored, plus its first 8 characters for display. The secret is shown once.
- A token acts as its owner, and only on groups the owner is a **member** of (checked on every call); a group-scoped
  token is limited to that group and stops working if the owner leaves it.
- Personal access tokens are rejected by the REST API (`/api`) — they can't create more tokens or manage the account.
- Max 10 active tokens per user; `lastUsedAt` is updated at most once a minute.
- The `/mcp` DM with the secret is not auto-deleted (people need time to copy it); revoke from the Mini App if a chat
  is shared.
