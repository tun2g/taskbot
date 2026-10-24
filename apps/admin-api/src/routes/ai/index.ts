import { Request, Response, Router } from 'express';
import { asyncHandler, paginated, pagination } from 'src/shared/http';
import { callFilter, callRows } from './calls';
import { rangeScope } from './params';
import { REFUSED_BY, RefusedBy, refusedRows } from './refused';
import { aiUsage, GROUP_BY, GroupBy } from './usage';

export { NO_GROUP_LABEL } from './usage';

export const aiRouter: Router = Router();

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(value)) ? (value as T) : fallback;

// GET /ai/usage?range=30d&groupBy=day|feature|model|group|user&groupId=&userId=
aiRouter.get(
  '/usage',
  asyncHandler(async (req: Request, res: Response) => {
    const { range, window, match } = rangeScope(req.query);
    const groupBy = oneOf<GroupBy>(req.query.groupBy, GROUP_BY, 'day');
    res.json({ data: await aiUsage(range, window, groupBy, match) });
  }),
);

// GET /ai/refused?by=person|group&range=30d&groupId=&userId=&page=&limit= — who was refused, most first.
aiRouter.get(
  '/refused',
  asyncHandler(async (req: Request, res: Response) => {
    const p = pagination(req.query as Record<string, unknown>, 10, 100);
    const { match } = rangeScope(req.query);
    const { rows, total } = await refusedRows(match, oneOf<RefusedBy>(req.query.by, REFUSED_BY, 'person'), p);
    res.json(paginated(rows, p, total));
  }),
);

// GET /ai/calls?status=&feature=&groupId=&userId=&model=&range=&page=&limit=
aiRouter.get(
  '/calls',
  asyncHandler(async (req: Request, res: Response) => {
    const p = pagination(req.query as Record<string, unknown>, 50, 200);
    const { rows, total } = await callRows(callFilter(req.query), p);
    res.json(paginated(rows, p, total));
  }),
);
