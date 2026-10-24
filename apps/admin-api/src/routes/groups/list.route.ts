import { Group } from '@tbot/db';
import { Request, Response, Router } from 'express';
import { groupRows } from 'src/routes/group-rows';
import { asyncHandler, paginated, pagination } from 'src/shared/http';
import { addPeriodNumbers, GROUP_SORTS, GroupSort, listFilter, loadPage, loadPeriod, periodIdFilter } from './list.query';

export const listRouter: Router = Router();

// GET /groups?status=&q=&sort=&activeIn=&page=&limit=
listRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const p = pagination(query);
    const filter = listFilter(query);
    const sort: GroupSort = (GROUP_SORTS as readonly string[]).includes(String(query.sort)) ? (query.sort as GroupSort) : 'lastActivity';
    const period = query.activeIn ? await loadPeriod(query.activeIn) : null;
    if (period) filter._id = periodIdFilter(period);

    const total = await Group.countDocuments(filter);
    const page = await loadPage(filter, sort, p, period);
    const rows = await groupRows(page);
    if (period) await addPeriodNumbers(rows, page, period);
    res.json(paginated(rows, p, total));
  }),
);
