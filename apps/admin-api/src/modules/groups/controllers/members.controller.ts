import type { AdminGroupMemberSort } from '@tbot/shared';
import { Request, Response } from 'express';
import { MEMBER_SORTS } from 'src/modules/groups/groups.schemas';
import { listMembers } from 'src/modules/groups/services/members.service';
import { objectIdParam, paginated, pagination } from 'src/shared/http';
import { parseRange } from 'src/stats/range';

// GET /groups/:id/members?range=30d&q=&sort=events&page=&limit= — people in the group who used the bot, paginated.
export async function members(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'group');
  const p = pagination(req.query as Record<string, unknown>);
  const sort: AdminGroupMemberSort = (MEMBER_SORTS as readonly string[]).includes(String(req.query.sort))
    ? (req.query.sort as AdminGroupMemberSort)
    : 'events';
  const { rows, total } = await listMembers(id, req.query.q, sort, parseRange(req.query.range), p);
  res.json(paginated(rows, p, total));
}
