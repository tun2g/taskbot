import { ApiToken, GroupMember, SETTINGS_CACHE_SECONDS, User, UsageEvent } from '@tbot/db';
import type { AdminUserDetail, AdminUserRow } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { Types } from 'mongoose';
import { iso } from 'src/routes/group-rows';
import { aiOverrideSchema } from 'src/routes/schemas';
import { writeAudit } from 'src/shared/audit';
import { asyncHandler, HttpError, objectIdParam, paginated, pagination, parseOr400, searchRegex } from 'src/shared/http';
import { loadGroupRefs, personRef, USER_REF_FIELDS } from 'src/shared/refs';
import { roundUsd } from 'src/stats/aggregate';
import { breakdownRows, featureLabel } from 'src/stats/breakdown';
import { aiTotalsBy, DAY_EXPR, eventCountsBy } from 'src/stats/queries';
import { lastDays, parseRange, rangeWindows } from 'src/stats/range';

export const usersRouter: Router = Router();

interface LeanUserDoc {
  _id: Types.ObjectId;
  telegramUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  lastSeenAt?: Date | null;
  ai?: { disabled?: boolean; dailyLimit?: number | null } | null;
  createdAt: Date;
}

const USER_FIELDS = `${USER_REF_FIELDS} lastSeenAt ai createdAt`;
const activeTokenMatch = (now: Date) => ({ revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });

async function countByUser(model: typeof GroupMember | typeof ApiToken, match: Record<string, unknown>): Promise<Map<string, number>> {
  const res = await (model as typeof GroupMember).aggregate([{ $match: match }, { $group: { _id: '$userId', n: { $sum: 1 } } }]);
  return new Map(res.map((r) => [String(r._id), r.n as number]));
}

export async function userRows(users: LeanUserDoc[], now = new Date()): Promise<AdminUserRow[]> {
  if (!users.length) return [];
  const ids = users.map((u) => u._id);
  const since = lastDays(30, now).start;
  const [groups, ai, events, tokens] = await Promise.all([
    countByUser(GroupMember, { userId: { $in: ids } }),
    aiTotalsBy({ userId: { $in: ids }, createdAt: { $gte: since } }, 'userId'),
    eventCountsBy({ userId: { $in: ids }, createdAt: { $gte: since } }, 'userId'),
    countByUser(ApiToken, { userId: { $in: ids }, ...activeTokenMatch(now) }),
  ]);
  return users.map((u) => {
    const id = String(u._id);
    const a = ai.get(id);
    return {
      person: personRef(u),
      groups: groups.get(id) ?? 0,
      lastSeenAt: iso(u.lastSeenAt),
      aiCalls30d: a?.calls ?? 0,
      aiCostUsd30d: roundUsd(a?.costUsd ?? 0),
      events30d: events.get(id) ?? 0,
      activeTokens: tokens.get(id) ?? 0,
      aiDisabled: !!u.ai?.disabled,
      aiDailyLimit: u.ai?.dailyLimit ?? null,
      createdAt: iso(u.createdAt) ?? new Date(0).toISOString(),
    };
  });
}

/** Start of the DAU / WAU / MAU window for ?activeIn= (null = no filter). Same windows as the overview. */
export function activeSince(value: unknown, now = new Date()): Date | null {
  const days = value === 'today' ? 1 : value === '7d' ? 7 : value === '30d' ? 30 : 0;
  return days ? lastDays(days, now).start : null;
}

const USER_SORTS = ['lastSeen', 'aiCost', 'aiCalls', 'events', 'tokens'] as const;
type UserSort = (typeof USER_SORTS)[number];

/** The number a non-date sort ranks people by (last 30 days, or active tokens now). */
async function sortMetric(sort: Exclude<UserSort, 'lastSeen'>, ids: Types.ObjectId[], since: Date): Promise<Map<string, number>> {
  const match = { userId: { $in: ids }, createdAt: { $gte: since } };
  if (sort === 'events') return eventCountsBy(match, 'userId');
  if (sort === 'tokens') return countByUser(ApiToken, { userId: { $in: ids }, ...activeTokenMatch(new Date()) });
  const ai = await aiTotalsBy(match, 'userId');
  return new Map([...ai.entries()].map(([k, v]) => [k, sort === 'aiCost' ? v.costUsd : v.calls]));
}

// GET /users?q=&sort=lastSeen|aiCost|aiCalls|events|tokens&activeIn=&hasTokens=1&page=&limit=
usersRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const p = pagination(req.query as Record<string, unknown>);
    const filter: Record<string, unknown> = {};
    const re = searchRegex(req.query.q);
    if (re) {
      const q = String(req.query.q).trim().replace(/^@/, '');
      const or: Record<string, unknown>[] = [{ username: searchRegex(q) }, { firstName: re }, { lastName: re }];
      if (/^\d+$/.test(q)) or.push({ telegramUserId: Number(q) });
      filter.$or = or;
    }
    const sort: UserSort = (USER_SORTS as readonly string[]).includes(String(req.query.sort)) ? (req.query.sort as UserSort) : 'lastSeen';
    // ?activeIn=today|7d|30d — the people behind DAU / WAU / MAU (same rule: any usage event since the window start).
    const since = activeSince(req.query.activeIn);
    if (since) {
      const ids = await UsageEvent.distinct('userId', { createdAt: { $gte: since }, userId: { $ne: null } });
      filter._id = { $in: ids };
    }
    // ?hasTokens=1 — the people behind MCP "Active tokens".
    if (req.query.hasTokens === '1' || req.query.hasTokens === 'true') {
      const owners = await ApiToken.distinct('userId', activeTokenMatch(new Date()));
      const prev = filter._id as { $in: unknown[] } | undefined;
      const set = new Set(owners.map(String));
      filter._id = { $in: prev ? prev.$in.filter((x) => set.has(String(x))) : owners };
    }
    const total = await User.countDocuments(filter);
    let page: LeanUserDoc[];
    if (sort === 'lastSeen') {
      page = await User.find(filter).select(USER_FIELDS).sort({ lastSeenAt: -1, createdAt: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean<LeanUserDoc[]>();
    } else {
      const all = await User.find(filter).select('_id createdAt').lean<{ _id: Types.ObjectId; createdAt: Date }[]>();
      const ids = all.map((u) => u._id);
      const since = lastDays(30).start;
      const metric = await sortMetric(sort, ids, since);
      const ranked = all
        .sort((a, b) => (metric.get(String(b._id)) ?? 0) - (metric.get(String(a._id)) ?? 0) || +b.createdAt - +a.createdAt)
        .slice(p.skip, p.skip + p.limit)
        .map((u) => u._id);
      const docs = await User.find({ _id: { $in: ranked } }).select(USER_FIELDS).lean<LeanUserDoc[]>();
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      page = ranked.map((id) => byId.get(String(id))).filter((u): u is LeanUserDoc => !!u);
    }
    res.json(paginated(await userRows(page), p, total));
  }),
);

async function findUser(id: Types.ObjectId): Promise<LeanUserDoc> {
  const u = await User.findById(id).select(USER_FIELDS).lean<LeanUserDoc>();
  if (!u) throw new HttpError(404, "This person doesn't exist in the bot's records.");
  return u;
}

// GET /users/:id?range=30d
usersRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'person');
    const u = await findUser(id);
    const { current: window } = rangeWindows(parseRange(req.query.range));
    const inRange = { $gte: window.start, $lt: window.end };
    const now = new Date();
    const [[row], memberships, eventsByGroup, aiByGroup, aiByFeature, aiByDay, eventsByDay, tokens] = await Promise.all([
      userRows([u], now),
      GroupMember.find({ userId: id }).select('groupId joinedAt').lean<{ groupId: Types.ObjectId; joinedAt?: Date }[]>(),
      eventCountsBy({ userId: id, createdAt: inRange }, 'groupId'),
      aiTotalsBy({ userId: id, createdAt: inRange }, 'groupId'),
      aiTotalsBy({ userId: id, createdAt: inRange }, 'feature'),
      aiTotalsBy({ userId: id, createdAt: inRange }, DAY_EXPR('createdAt')),
      UsageEvent.aggregate([{ $match: { userId: id, createdAt: inRange } }, { $group: { _id: DAY_EXPR('createdAt'), n: { $sum: 1 } } }]),
      ApiToken.find({ userId: id, revokedAt: null })
        .select('name prefix groupId lastUsedAt createdAt expiresAt')
        .sort({ createdAt: -1 })
        .lean<{ _id: Types.ObjectId; name: string; prefix: string; groupId: Types.ObjectId | null; lastUsedAt: Date | null; createdAt: Date; expiresAt: Date | null }[]>(),
    ]);
    const groupRefs = await loadGroupRefs([...memberships.map((m) => m.groupId), ...tokens.map((t) => t.groupId)]);
    const eventsDay = new Map(eventsByDay.map((e) => [String(e._id), e.n as number]));

    const detail: AdminUserDetail = {
      ...row,
      groupList: memberships
        .filter((m) => groupRefs.has(String(m.groupId)))
        .map((m) => {
          const gid = String(m.groupId);
          return {
            group: groupRefs.get(gid)!,
            joinedAt: iso(m.joinedAt),
            events: eventsByGroup.get(gid) ?? 0,
            aiCostUsd: roundUsd(aiByGroup.get(gid)?.costUsd ?? 0),
          };
        })
        .sort((a, b) => b.events - a.events || a.group.name.localeCompare(b.group.name)),
      daily: window.days.map((day) => ({
        day,
        events: eventsDay.get(day) ?? 0,
        aiCalls: aiByDay.get(day)?.calls ?? 0,
        aiCostUsd: roundUsd(aiByDay.get(day)?.costUsd ?? 0),
      })),
      aiByFeature: breakdownRows(aiByFeature, featureLabel),
      tokens: tokens.map((t) => ({
        id: String(t._id),
        name: t.name,
        prefix: t.prefix,
        group: t.groupId ? (groupRefs.get(String(t.groupId)) ?? null) : null,
        lastUsedAt: iso(t.lastUsedAt),
        createdAt: iso(t.createdAt)!,
        expiresAt: iso(t.expiresAt),
      })),
    };
    res.json({ data: detail });
  }),
);

// PATCH /users/:id/ai { disabled?, dailyLimit? }
usersRouter.patch(
  '/:id/ai',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'person');
    const input = parseOr400(aiOverrideSchema, req.body);
    const before = await findUser(id);
    const set: Record<string, unknown> = {};
    if (input.disabled !== undefined) set['ai.disabled'] = input.disabled;
    if (input.dailyLimit !== undefined) set['ai.dailyLimit'] = input.dailyLimit;
    await User.updateOne({ _id: id }, { $set: set });
    const after = await findUser(id);
    const [row] = await userRows([after]);
    await writeAudit(req, {
      action: 'user.ai',
      targetType: 'user',
      targetId: String(id),
      targetLabel: row.person.name,
      details: {
        before: { disabled: !!before.ai?.disabled, dailyLimit: before.ai?.dailyLimit ?? null },
        after: { disabled: !!after.ai?.disabled, dailyLimit: after.ai?.dailyLimit ?? null },
      },
    });
    res.json({ data: { ...row, appliesWithinSeconds: SETTINGS_CACHE_SECONDS } });
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
    const label = personRef(u).name;
    await writeAudit(req, { action: 'user.revoke_tokens', targetType: 'user', targetId: String(id), targetLabel: label, details: { revoked } });
    res.json({ data: { revoked } });
  }),
);
