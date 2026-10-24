import { Request, Response } from 'express';
import { aiUsage, callRows, refusedRows } from 'src/modules/ai/ai.service';
import { callFilter } from 'src/modules/ai/helpers/call-filter';
import { GROUP_BY, GroupBy, oneOf, REFUSED_BY, RefusedBy } from 'src/modules/ai/helpers/options';
import { rangeScope } from 'src/modules/ai/helpers/params';
import { paginated, pagination } from 'src/shared/http';

// GET /ai/usage?range=30d&groupBy=day|feature|model|group|user&groupId=&userId=
export async function usage(req: Request, res: Response) {
  const { range, window, match } = rangeScope(req.query);
  const groupBy = oneOf<GroupBy>(req.query.groupBy, GROUP_BY, 'day');
  res.json({ data: await aiUsage(range, window, groupBy, match) });
}

// GET /ai/refused?by=person|group&range=30d&groupId=&userId=&page=&limit= — who was refused, most first.
export async function refused(req: Request, res: Response) {
  const p = pagination(req.query as Record<string, unknown>, 10, 100);
  const { match } = rangeScope(req.query);
  const { rows, total } = await refusedRows(match, oneOf<RefusedBy>(req.query.by, REFUSED_BY, 'person'), p);
  res.json(paginated(rows, p, total));
}

// GET /ai/calls?status=&feature=&groupId=&userId=&model=&range=&page=&limit=
export async function calls(req: Request, res: Response) {
  const p = pagination(req.query as Record<string, unknown>, 50, 200);
  const { rows, total } = await callRows(callFilter(req.query), p);
  res.json(paginated(rows, p, total));
}
