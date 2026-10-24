import { ApiToken, countGroupData, deleteGroupData, Epic, Group, GroupMember, SETTINGS_CACHE_SECONDS, Task, TaskActivity, User, UsageEvent } from '@tbot/db';
import type {
  AdminGroupDeletePreview,
  AdminGroupDetail,
  AdminGroupMemberRow,
  AdminGroupRow,
  UsageChannel,
  UsageKind,
} from '@tbot/shared';
import { GROUP_STATUS_VALUES } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { Types } from 'mongoose';
import { applyDecision, applyLeave, BOT_IN_CHAT } from 'src/routes/group-actions';
import { GROUP_FIELDS, groupRows, iso, LeanGroup, normalizeGroup, taskCountsBy } from 'src/routes/group-rows';
import { actionSchema, actionWithReasonSchema, aiOverrideSchema, deleteGroupSchema } from 'src/routes/schemas';
import { writeAudit } from 'src/shared/audit';
import { asyncHandler, HttpError, objectIdParam, paginated, pagination, parseOr400, searchRegex } from 'src/shared/http';
import { LeanUser, personRef, USER_REF_FIELDS } from 'src/shared/refs';
import { telegram } from 'src/shared/telegram';
import { GroupActivity, isActive, roundUsd } from 'src/stats/aggregate';
import { breakdownRows, featureLabel } from 'src/stats/breakdown';
import { aiTotalsBy, dailySeries, groupActivity, lastRolledDay } from 'src/stats/queries';
import { lastDays, parseRange, rangeWindows } from 'src/stats/range';

export const groupsRouter: Router = Router();

const GROUP_SORTS = ['lastActivity', 'aiCost', 'tasks', 'members', 'added'] as const;
type GroupSort = (typeof GROUP_SORTS)[number];

async function findGroup(id: Types.ObjectId): Promise<LeanGroup> {
  const g = await Group.findById(id).select(GROUP_FIELDS).lean<LeanGroup>();
  if (!g) throw new HttpError(404, "This group doesn't exist (it may have been deleted).");
  return normalizeGroup(g);
}

// GET /groups?status=&q=&sort=&page=&limit=
groupsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const p = pagination(req.query as Record<string, unknown>);
    const filter: Record<string, unknown> = {};
    const status = String(req.query.status ?? '');
    if (status) {
      const list = status.split(',').filter((s) => (GROUP_STATUS_VALUES as string[]).includes(s));
      if (list.length) filter.status = { $in: list };
    }
    const re = searchRegex(req.query.q);
    if (re) {
      const or: Record<string, unknown>[] = [{ groupName: re }];
      const q = String(req.query.q).trim();
      if (/^-?\d+$/.test(q)) or.push({ telegramGroupId: Number(q) });
      filter.$or = or;
    }
    const sort: GroupSort = (GROUP_SORTS as readonly string[]).includes(String(req.query.sort)) ? (req.query.sort as GroupSort) : 'lastActivity';

    // ?activeIn=30d — the groups behind the overview's "Active groups" number (same activity rule, same window).
    let period: Map<string, GroupActivity> | null = null;
    if (req.query.activeIn) {
      const { current } = rangeWindows(parseRange(req.query.activeIn));
      const activity = await groupActivity(current, await lastRolledDay());
      period = new Map([...activity.entries()].filter(([, a]) => isActive(a)));
      filter._id = { $in: [...period.keys()].filter((k) => Types.ObjectId.isValid(k)).map((k) => new Types.ObjectId(k)) };
    }
    const total = await Group.countDocuments(filter);

    let page: LeanGroup[];
    if (period && (sort === 'lastActivity' || sort === 'tasks')) {
      // In a period, "most active" and "tasks" mean in that period (requests / tasks created), not all time.
      const p2 = period;
      const all = await Group.find(filter).select('_id createdAt').lean<{ _id: Types.ObjectId; createdAt: Date }[]>();
      const score = (id: string) => {
        const a = p2.get(id);
        return sort === 'tasks' ? (a?.tasksCreated ?? 0) : (a?.events ?? 0);
      };
      const ranked = all
        .sort((a, b) => score(String(b._id)) - score(String(a._id)) || +b.createdAt - +a.createdAt)
        .slice(p.skip, p.skip + p.limit)
        .map((g) => g._id);
      const docs = await Group.find({ _id: { $in: ranked } }).select(GROUP_FIELDS).lean<LeanGroup[]>();
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      page = ranked.map((id) => byId.get(String(id))).filter((g): g is LeanGroup => !!g);
    } else if (sort === 'lastActivity' || sort === 'added' || sort === 'members') {
      const mongoSort: Record<string, 1 | -1> =
        sort === 'lastActivity'
          ? { lastActivityAt: -1, createdAt: -1, _id: -1 }
          : sort === 'added'
            ? { addedAt: -1, createdAt: -1, _id: -1 }
            : { memberCount: -1, _id: -1 };
      page = await Group.find(filter).select(GROUP_FIELDS).sort(mongoSort).skip(p.skip).limit(p.limit).lean<LeanGroup[]>();
    } else {
      // Computed sorts: rank every matching group by the metric, then load one page.
      const all = await Group.find(filter).select('_id createdAt').lean<{ _id: Types.ObjectId; createdAt: Date }[]>();
      const ids = all.map((g) => g._id);
      const metric =
        sort === 'tasks'
          ? new Map([...(await taskCountsBy({ groupId: { $in: ids } })).entries()].map(([k, v]) => [k, v.tasks]))
          : new Map(
              [...(await aiTotalsBy({ groupId: { $in: ids }, createdAt: { $gte: lastDays(30).start } }, 'groupId')).entries()].map(([k, v]) => [k, v.costUsd]),
            );
      const ranked = all
        .sort((a, b) => (metric.get(String(b._id)) ?? 0) - (metric.get(String(a._id)) ?? 0) || +b.createdAt - +a.createdAt)
        .slice(p.skip, p.skip + p.limit)
        .map((g) => g._id);
      const docs = await Group.find({ _id: { $in: ranked } }).select(GROUP_FIELDS).lean<LeanGroup[]>();
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      page = ranked.map((id) => byId.get(String(id))).filter((g): g is LeanGroup => !!g);
    }
    const rows = await groupRows(page);
    if (period) {
      for (const r of rows) {
        const a = period.get(r.id);
        r.inPeriod = { events: a?.events ?? 0, tasksCreated: a?.tasksCreated ?? 0, aiCalls: a?.aiCalls ?? 0, aiCostUsd: roundUsd(a?.aiCostUsd ?? 0) };
      }
    }
    res.json(paginated(rows, p, total));
  }),
);

/** Public link + fresh member count from Telegram (best effort; only while the bot is in the chat). */
async function telegramFacts(g: LeanGroup): Promise<{ publicLink: string | null; memberCount: number | null }> {
  if (!BOT_IN_CHAT.includes(g.status)) return { publicLink: null, memberCount: g.memberCount ?? null };
  const [chat, count] = await Promise.all([telegram.getChat(g.telegramGroupId), telegram.getChatMemberCount(g.telegramGroupId)]);
  const memberCount = count.ok ? count.result : (g.memberCount ?? null);
  if (count.ok && count.result !== g.memberCount) await Group.updateOne({ _id: g._id }, { $set: { memberCount: count.result } });
  return { publicLink: chat.ok && chat.result.username ? `https://t.me/${chat.result.username}` : null, memberCount };
}

// GET /groups/:id?range=30d — numbers only (never task titles, descriptions or message text).
groupsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const g = await findGroup(id);
    const { current: window } = rangeWindows(parseRange(req.query.range));
    const inRange = { $gte: window.start, $lt: window.end };
    const now = new Date();

    const [[row], facts, lastRolled, epics, activities, activeTokens, aiFeature, memberDocs, usageRaw, eventsByUser, aiByUser, tasksByUser, lastHereByUser] =
      await Promise.all([
        groupRows([g], now),
        telegramFacts(g),
        lastRolledDay(now),
        Epic.countDocuments({ groupId: id }),
        TaskActivity.countDocuments({ groupId: id }),
        ApiToken.countDocuments({ groupId: id, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
        aiTotalsBy({ groupId: id, createdAt: inRange }, 'feature'),
        GroupMember.find({ groupId: id }).select('userId telegramUserId joinedAt').limit(1000).lean<{ userId: Types.ObjectId; telegramUserId: number; joinedAt?: Date }[]>(),
        UsageEvent.aggregate([
          { $match: { groupId: id, createdAt: inRange } },
          { $group: { _id: { channel: '$channel', kind: '$kind' }, count: { $sum: 1 } } },
        ]),
        UsageEvent.aggregate([{ $match: { groupId: id, createdAt: inRange, userId: { $ne: null } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]),
        aiTotalsBy({ groupId: id, createdAt: inRange }, 'userId'),
        Task.aggregate([{ $match: { groupId: id, createdAt: inRange } }, { $group: { _id: '$createdBy', n: { $sum: 1 } } }]),
        // Last time each person used the bot in this group (usage events are kept 90 days).
        UsageEvent.aggregate([{ $match: { groupId: id, userId: { $ne: null } } }, { $group: { _id: '$userId', at: { $max: '$createdAt' } } }]),
      ]);
    const daily = await dailySeries(window, id, lastRolled);

    const users = await User.find({ _id: { $in: memberDocs.map((m) => m.userId) } })
      .select(`${USER_REF_FIELDS} lastSeenAt`)
      .lean<(LeanUser & { lastSeenAt?: Date | null })[]>();
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const events = new Map(eventsByUser.map((e) => [String(e._id), e.n as number]));
    const created = new Map(tasksByUser.map((t) => [String(t._id), t.n as number]));
    const lastHere = new Map(lastHereByUser.map((e) => [String(e._id), e.at as Date]));
    // Tokens that reach this group: scoped to it, or to all of the person's groups.
    const memberTokens = await ApiToken.aggregate([
      {
        $match: {
          userId: { $in: memberDocs.map((m) => m.userId) },
          revokedAt: null,
          $and: [{ $or: [{ groupId: id }, { groupId: null }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }],
        },
      },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
    ]);
    const tokensByUser = new Map(memberTokens.map((t) => [String(t._id), t.n as number]));
    const members: AdminGroupMemberRow[] = memberDocs
      .map((m) => {
        const u = userById.get(String(m.userId));
        const uid = String(m.userId);
        const ai = aiByUser.get(uid);
        return {
          person: u ? personRef(u) : { id: uid, telegramUserId: m.telegramUserId, name: `User ${m.telegramUserId}`, username: null },
          joinedAt: iso(m.joinedAt),
          lastSeenAt: iso(u?.lastSeenAt),
          lastActiveHereAt: iso(lastHere.get(uid)),
          activeTokens: tokensByUser.get(uid) ?? 0,
          events: events.get(uid) ?? 0,
          aiCalls: ai?.calls ?? 0,
          aiCostUsd: roundUsd(ai?.costUsd ?? 0),
          tasksCreated: created.get(uid) ?? 0,
        };
      })
      .sort((a, b) => b.events - a.events || b.tasksCreated - a.tasksCreated || a.person.name.localeCompare(b.person.name));

    const detail: AdminGroupDetail = {
      ...row,
      memberCount: facts.memberCount,
      timezone: g.timezone || 'UTC',
      approvedAt: iso(g.approvedAt),
      botLeftAt: iso(g.botLeftAt),
      migratedToChatId: g.migratedToChatId ?? null,
      publicLink: facts.publicLink,
      counts: { epics, activities, activeTokens },
      daily,
      aiByFeature: breakdownRows(aiFeature, featureLabel),
      members,
      usage: usageRaw
        .map((u) => ({ channel: u._id.channel as UsageChannel, kind: u._id.kind as UsageKind, count: u.count as number }))
        .sort((a, b) => b.count - a.count),
    };
    res.json({ data: detail });
  }),
);

// GET /groups/:id/delete-preview
groupsRouter.get(
  '/:id/delete-preview',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const g = await findGroup(id);
    const counts = await countGroupData(id);
    const body: AdminGroupDeletePreview = { group: { id: String(g._id), name: g.groupName, status: g.status }, ...counts };
    res.json({ data: body });
  }),
);

// DELETE /groups/:id { confirmName } — the bot leaves the chat first (best effort), then the data is deleted.
groupsRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const { confirmName } = parseOr400(deleteGroupSchema, req.body);
    const g = await findGroup(id);
    if (confirmName !== g.groupName) {
      throw new HttpError(400, `The name doesn't match. Type “${g.groupName}” exactly to delete this group.`);
    }
    const warnings: string[] = [];
    if (BOT_IN_CHAT.includes(g.status)) {
      const left = await telegram.leaveChat(g.telegramGroupId);
      if (!left.ok) warnings.push(`Couldn't make the bot leave the chat (${left.error}). Remove it from the group in Telegram if it is still there.`);
    }
    const deleted = await deleteGroupData(id);
    await writeAudit(req, {
      action: 'group.delete',
      targetType: 'group',
      targetId: String(id),
      targetLabel: g.groupName,
      details: { ...deleted, telegramGroupId: g.telegramGroupId, statusBefore: g.status, ...(warnings.length ? { warnings } : {}) },
    });
    res.json({ data: { deleted, warnings } });
  }),
);

type ActionRow = AdminGroupRow & { warnings: string[] };

async function actionResponse(outcome: { group: LeanGroup; warnings: string[] }): Promise<ActionRow> {
  const [row] = await groupRows([outcome.group]);
  return { ...row, warnings: outcome.warnings };
}

for (const decision of ['approve', 'reject', 'suspend', 'unsuspend'] as const) {
  groupsRouter.post(
    `/:id/${decision}`,
    asyncHandler(async (req: Request, res: Response) => {
      const id = objectIdParam(req.params.id, 'group');
      const input = parseOr400(decision === 'reject' || decision === 'suspend' ? actionWithReasonSchema : actionSchema, req.body);
      res.json({ data: await actionResponse(await applyDecision(req, id, decision, input)) });
    }),
  );
}

groupsRouter.post(
  '/:id/leave',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const input = parseOr400(actionSchema, req.body);
    res.json({ data: await actionResponse(await applyLeave(req, id, input)) });
  }),
);

// PATCH /groups/:id/ai { disabled?, dailyLimit? }
groupsRouter.patch(
  '/:id/ai',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const input = parseOr400(aiOverrideSchema, req.body);
    const before = await findGroup(id);
    const set: Record<string, unknown> = {};
    if (input.disabled !== undefined) set['ai.disabled'] = input.disabled;
    if (input.dailyLimit !== undefined) set['ai.dailyLimit'] = input.dailyLimit;
    await Group.updateOne({ _id: id }, { $set: set });
    const after = await findGroup(id);
    await writeAudit(req, {
      action: 'group.ai',
      targetType: 'group',
      targetId: String(id),
      targetLabel: before.groupName,
      details: {
        before: { disabled: !!before.ai?.disabled, dailyLimit: before.ai?.dailyLimit ?? null },
        after: { disabled: !!after.ai?.disabled, dailyLimit: after.ai?.dailyLimit ?? null },
      },
    });
    const [row] = await groupRows([after]);
    res.json({ data: { ...row, appliesWithinSeconds: SETTINGS_CACHE_SECONDS } });
  }),
);

