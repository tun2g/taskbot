import type { AdminGroupMemberSort } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { asyncHandler, objectIdParam, paginated, pagination } from 'src/shared/http';
import { parseRange, rangeWindows } from 'src/stats/range';
import { findGroup } from './find-group';
import { findMembers, MEMBER_SORTS, memberMetrics, memberRows, sortMembers } from './members.query';

export const membersRouter: Router = Router();

// GET /groups/:id/members?range=30d&q=&sort=events&page=&limit= — people in the group who used the bot, paginated.
membersRouter.get(
  '/:id/members',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    await findGroup(id);
    const p = pagination(req.query as Record<string, unknown>);
    const sort: AdminGroupMemberSort = (MEMBER_SORTS as readonly string[]).includes(String(req.query.sort))
      ? (req.query.sort as AdminGroupMemberSort)
      : 'events';
    const { current: window } = rangeWindows(parseRange(req.query.range));

    const docs = await findMembers(id, req.query.q);
    const metrics = await memberMetrics(id, docs.map((d) => d.userId), window);
    const page = sortMembers(docs, metrics, sort).slice(p.skip, p.skip + p.limit);
    res.json(paginated(await memberRows(page, metrics), p, docs.length));
  }),
);
