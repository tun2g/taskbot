# admin-api structure

Code is grouped by module, and each module has the same layers:

```
src/modules/<module>/
  <module>.routes.ts       path + middleware → controller. No logic.
  <module>.controller.ts   reads req (params/query/body), validates with the schemas, calls the service, sends res.
  <module>.service.ts      business rules. No req parsing, no res. May take `req` only to pass it to writeAudit.
  <module>.repository.ts   Mongo / Redis data access: queries, aggregations, updates. No business rules. (Telegram calls go through src/shared/telegram from the service.)
  <module>.schemas.ts      zod schemas for the module's inputs.
  helpers/                 small pure helpers of this module (row mapping, formatting, constants).
```

- A layer that grows past ~150 lines becomes a folder with one file per feature:
  `services/list.service.ts`, `repositories/members.repository.ts`, `controllers/tasks.controller.ts`.
- Dependencies go one way: routes → controller → service → repository. A controller never calls a repository.
- Another module is used only through its service (or its repository for shared types like `LeanGroup`), never its controller/routes/helpers.
- `src/shared/` is infrastructure used by every module (http, logger, redis, telegram, audit, refs, format, ai-override).
- `src/stats/` is the shared analytics library (aggregations over usage events and daily stats).
- Imports use the `src/...` path, not `./`.

`src/modules/settings/` is the smallest complete example.
