import type { AdminGroupTaskFilter } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { asyncHandler, objectIdParam, paginated, pagination } from 'src/shared/http';
import { findGroup } from './find-group';
import { epicPage, TASK_FILTERS, taskBaseMatch, taskPage, taskRows } from './tasks.query';

export const tasksRouter: Router = Router();

/**
 * GET /groups/:id/tasks?filter=open|overdue|done|all&createdIn=7d|30d|90d&q=&page=&limit= — read-only list behind the
 * group's task numbers. Titles only (never descriptions or message text). `counts` = how many tasks each filter has.
 */
tasksRouter.get(
  '/:id/tasks',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    await findGroup(id);
    const query = req.query as Record<string, unknown>;
    const p = pagination(query);
    const filter: AdminGroupTaskFilter = (TASK_FILTERS as readonly string[]).includes(String(query.filter))
      ? (query.filter as AdminGroupTaskFilter)
      : 'open';
    const now = new Date();
    const { docs, counts } = await taskPage(taskBaseMatch(id, query), filter, p, now);
    res.json({ ...paginated(await taskRows(docs, now), p, counts[filter]), counts });
  }),
);

// GET /groups/:id/epics?page=&limit= — the epics behind the group's "Epics" count, open ones first.
tasksRouter.get(
  '/:id/epics',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    await findGroup(id);
    const p = pagination(req.query as Record<string, unknown>);
    const { rows, total } = await epicPage(id, p);
    res.json(paginated(rows, p, total));
  }),
);
