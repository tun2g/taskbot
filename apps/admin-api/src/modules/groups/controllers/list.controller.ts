import { Request, Response } from 'express';
import { GROUP_SORTS, GroupSort } from 'src/modules/groups/groups.schemas';
import { listGroups } from 'src/modules/groups/services/list.service';
import { paginated, pagination } from 'src/shared/http';

// GET /groups?status=&q=&sort=&activeIn=&page=&limit=
export async function list(req: Request, res: Response) {
  const query = req.query as Record<string, unknown>;
  const p = pagination(query);
  const sort: GroupSort = (GROUP_SORTS as readonly string[]).includes(String(query.sort))
    ? (query.sort as GroupSort)
    : 'lastActivity';
  const { rows, total } = await listGroups(query, sort, p);
  res.json(paginated(rows, p, total));
}
