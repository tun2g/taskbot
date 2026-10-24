import { ApiToken, SETTINGS_CACHE_SECONDS, User } from '@tbot/db';
import { Request, Response, Router } from 'express';
import { aiOverrideSet, overrideSnapshot } from 'src/routes/ai-override';
import { aiOverrideSchema } from 'src/routes/schemas';
import { writeAudit } from 'src/shared/audit';
import { asyncHandler, objectIdParam, paginated, pagination, parseOr400 } from 'src/shared/http';
import { personRef } from 'src/shared/refs';
import { parseRange } from 'src/stats/range';
import { userDetail } from './detail';
import { USER_SORTS, UserSort, userFilter, userPage } from './list';
import { findUser, userRows } from './rows';

export { activeSince } from './list';
export { userRows } from './rows';

export const usersRouter: Router = Router();

// GET /users?q=&sort=lastSeen|aiCost|aiCalls|events|tokens&range=&activeIn=&hasTokens=1&page=&limit=
usersRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const p = pagination(req.query as Record<string, unknown>);
    const range = parseRange(req.query.range);
    const sort: UserSort = (USER_SORTS as readonly string[]).includes(String(req.query.sort)) ? (req.query.sort as UserSort) : 'lastSeen';
    const filter = await userFilter(req.query);
    const [total, page] = await Promise.all([User.countDocuments(filter), userPage(filter, sort, range, p)]);
    res.json(paginated(await userRows(page, range), p, total));
  }),
);

// GET /users/:id?range=30d
usersRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const u = await findUser(objectIdParam(req.params.id, 'person'));
    res.json({ data: await userDetail(u, parseRange(req.query.range)) });
  }),
);

// PATCH /users/:id/ai { disabled?, dailyLimit?, reason? }
usersRouter.patch(
  '/:id/ai',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'person');
    const input = parseOr400(aiOverrideSchema, req.body);
    const before = await findUser(id);
    await User.updateOne({ _id: id }, { $set: aiOverrideSet(input, before.ai) });
    const after = await findUser(id);
    const [row] = await userRows([after]);
    const auditId = await writeAudit(req, {
      action: 'user.ai',
      targetType: 'user',
      targetId: String(id),
      targetLabel: row.person.name,
      reason: after.ai?.reason ?? null,
      details: { before: overrideSnapshot(before.ai), after: overrideSnapshot(after.ai) },
    });
    res.json({ data: { ...row, appliesWithinSeconds: SETTINGS_CACHE_SECONDS, auditId } });
  }),
);

// POST /users/:id/revoke-tokens — revokes every MCP token of this person (takes effect immediately).
usersRouter.post(
  '/:id/revoke-tokens',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'person');
    const u = await findUser(id);
    const result = await ApiToken.updateMany({ userId: id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const revoked = result.modifiedCount ?? 0;
    await writeAudit(req, { action: 'user.revoke_tokens', targetType: 'user', targetId: String(id), targetLabel: personRef(u).name, details: { revoked } });
    res.json({ data: { revoked } });
  }),
);
