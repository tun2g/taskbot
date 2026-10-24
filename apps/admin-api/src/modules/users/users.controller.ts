import { Request, Response } from 'express';
import { USER_SORTS, UserSort } from 'src/modules/users/helpers/sorts';
import { findUser, listUsers, revokeUserTokens, updateUserAi, userDetail } from 'src/modules/users/users.service';
import { aiOverrideSchema } from 'src/shared/ai-override';
import { objectIdParam, paginated, pagination, parseOr400 } from 'src/shared/http';
import { parseRange } from 'src/stats/range';

// GET /users?q=&sort=lastSeen|aiCost|aiCalls|events|tokens&range=&activeIn=&hasTokens=1&page=&limit=
export async function list(req: Request, res: Response) {
  const p = pagination(req.query as Record<string, unknown>);
  const range = parseRange(req.query.range);
  const sort: UserSort = (USER_SORTS as readonly string[]).includes(String(req.query.sort)) ? (req.query.sort as UserSort) : 'lastSeen';
  const { q, activeIn, hasTokens } = req.query;
  const { rows, total } = await listUsers({ q, activeIn, hasTokens }, sort, range, p);
  res.json(paginated(rows, p, total));
}

// GET /users/:id?range=30d
export async function detail(req: Request, res: Response) {
  const u = await findUser(objectIdParam(req.params.id, 'person'));
  res.json({ data: await userDetail(u, parseRange(req.query.range)) });
}

// PATCH /users/:id/ai { disabled?, dailyLimit?, reason? }
export async function patchAi(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'person');
  const input = parseOr400(aiOverrideSchema, req.body);
  res.json({ data: await updateUserAi(req, id, input) });
}

// POST /users/:id/revoke-tokens — revokes every MCP token of this person (takes effect immediately).
export async function revokeTokens(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'person');
  res.json({ data: await revokeUserTokens(req, id) });
}
