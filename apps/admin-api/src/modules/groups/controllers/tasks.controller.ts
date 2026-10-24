import type { AdminGroupTaskFilter } from '@tbot/shared';
import { Request, Response } from 'express';
import { TASK_FILTERS } from 'src/modules/groups/groups.schemas';
import { listEpics, listTasks } from 'src/modules/groups/services/tasks.service';
import { objectIdParam, paginated, pagination } from 'src/shared/http';

/**
 * GET /groups/:id/tasks?filter=open|overdue|done|all&createdIn=7d|30d|90d&q=&page=&limit= — read-only list behind the
 * group's task numbers. Titles only (never descriptions or message text). `counts` = how many tasks each filter has.
 */
export async function tasks(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'group');
  const query = req.query as Record<string, unknown>;
  const p = pagination(query);
  const filter: AdminGroupTaskFilter = (TASK_FILTERS as readonly string[]).includes(String(query.filter))
    ? (query.filter as AdminGroupTaskFilter)
    : 'open';
  const { rows, counts } = await listTasks(id, query, filter, p);
  res.json({ ...paginated(rows, p, counts[filter]), counts });
}

// GET /groups/:id/epics?page=&limit= — the epics behind the group's "Epics" count, open ones first.
export async function epics(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'group');
  const p = pagination(req.query as Record<string, unknown>);
  const { rows, total } = await listEpics(id, p);
  res.json(paginated(rows, p, total));
}
