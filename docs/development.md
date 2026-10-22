# Development

## Scripts (root)

```bash
pnpm dev          # run all apps (turbo)
pnpm dev:bot      # bot only
pnpm dev:web      # web only
pnpm build        # build all packages
pnpm check-types  # type-check all packages
pnpm lint         # lint all packages (see Known issues)
pnpm format       # prettier --write across the repo
pnpm commit       # Conventional Commit prompt (commitizen)
```

Each app has its own scripts too; see [`apps/bot/README.md`](../apps/bot/README.md) and
[`apps/web/README.md`](../apps/web/README.md).

## Tests

```bash
cd apps/bot && pnpm test           # Jest unit tests: commands, controllers, services, jobs, MCP
cd apps/bot && pnpm test:coverage  # with coverage
```

## Project structure

```text
taskbot/
├── apps/
│   ├── bot/                     # @tbot/bot: Telegraf bot + Express REST API + MCP server
│   │   └── src/
│   │       ├── index.ts         # bootstrap (DB, migrations, jobs, webhook/polling, server)
│   │       ├── server.ts        # Express app + CORS
│   │       ├── bot/             # commands, middlewares, callbacks, task card renderer, subtasks
│   │       ├── api/             # REST controllers, routes, auth, validation
│   │       ├── mcp/             # MCP server, tools, token auth
│   │       ├── database/        # Mongoose models + services
│   │       ├── jobs/            # Bull processors (due reminders, daily digest)
│   │       ├── shared/services/ # AI providers, AI commands, notifications, Redis, queue, ...
│   │       ├── configs/         # env-backed config
│   │       └── __tests__/       # Jest tests
│   └── web/                     # @tbot/web: React Mini App
│       └── src/
│           ├── routes/          # TanStack file-based routes
│           ├── pages/           # page → container → content → components
│           ├── components/      # shared UI, AI chat, epics, subtasks
│           └── api/             # API client + React Query Kit hooks
├── packages/
│   └── shared/                  # @tbot/shared: types + constants (statuses, types, priorities)
├── docs/                        # documentation, demo assets
├── docker-compose.yml           # production-style: bot + MongoDB + Redis
├── docker-compose.dev.yml       # local MongoDB + Redis
└── Dockerfile                   # bot image
```

## Architecture notes

- **Multi-tenancy:** every query is scoped by `groupId` (one Telegram group = one workspace).
- **Mini App auth:** Telegram `initData` is validated server-side via `@telegram-apps/init-data-node` (no separate auth
  system). In a normal browser, the Telegram Login Widget is used instead.
- **Bidirectional sync:** task changes in the Mini App edit the task card in the group chat, and vice versa.
- **Scheduled jobs (Bull):** `due-reminder` and `daily-digest` both run hourly and decide per group, in the group's
  timezone, whether to send (due-date reminders from 9:00, the digest at 9:00).
- **Bot commands** register via `.register()` returning a `Map<string, handler>`, added to the command maps in
  `apps/bot/src/bot/index.ts`.

See [`CLAUDE.md`](../CLAUDE.md) for deeper conventions.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, ...). Run
`pnpm commit` for a guided commitizen prompt.

## Known issues

- **`pnpm lint` does not work yet.** ESLint 9 is installed, but the apps still use legacy `.eslintrc` files (ignored by
  v9), and `eslint-import-resolver-typescript` is incompatible with v9. It needs a migration to flat config
  (`eslint.config.js`). Type-checking (`pnpm check-types`) and tests work.
