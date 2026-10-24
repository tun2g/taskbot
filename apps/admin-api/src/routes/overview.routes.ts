import { AiCall, Group } from '@tbot/db';
import type { AdminOverview } from '@tbot/shared';
import { GROUP_STATUS_VALUES, GroupStatus } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { Types } from 'mongoose';
import { loadBotRuntime } from 'src/shared/runtime';
import { GROUP_FIELDS, groupRows, LeanGroup } from 'src/routes/group-rows';
import { loadAiSettings } from 'src/routes/settings.routes';
import { readQueue } from 'src/routes/system.routes';
import { asyncHandler } from 'src/shared/http';
import logger from 'src/shared/logger';
import { getKv } from 'src/shared/redis';
import { loadAttention } from 'src/stats/attention';
import { deletedGroupRef, loadGroupRefs } from 'src/shared/refs';
import { countActiveGroups, kpi, roundUsd, sumSeries, topBy } from 'src/stats/aggregate';
import { dailySeries, distinctActiveUsers, groupActivity, lastRolledDay, trackingSince } from 'src/stats/queries';
import { lastDays, parseRange, rangeWindows } from 'src/stats/range';

export const overviewRouter: Router = Router();

async function existingGroupIds(ids: string[]): Promise<Set<string>> {
  const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (!valid.length) return new Set();
  const docs = await Group.find({ _id: { $in: valid } }).select('_id').lean<{ _id: Types.ObjectId }[]>();
  return new Set(docs.map((d) => String(d._id)));
}

/**
 * Today's AI numbers. Calls refused by the daily call limit ("quota" rows) are recorded too, but they aren't
 * calls to the provider and don't count toward the limit — counting them would show "612 / 500 calls".
 */
export const AI_TODAY_GROUP = {
  cost: { $sum: '$costUsd' },
  calls: { $sum: { $cond: [{ $in: ['$status', ['quota', 'disabled']] }, 0, 1] } },
  blocked: { $sum: { $cond: [{ $in: ['$status', ['quota', 'disabled']] }, 1, 0] } },
};

/** Count of groups per status, with every status present (0 when none). */
export function statusCounts(rows: { _id: string; n: number }[]): Record<GroupStatus, number> {
  const out = Object.fromEntries(GROUP_STATUS_VALUES.map((s) => [s, 0])) as Record<GroupStatus, number>;
  for (const r of rows) if (r._id in out) out[r._id as GroupStatus] = r.n;
  return out;
}

overviewRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const range = parseRange(req.query.range);
    const now = new Date();
    const { current, previous } = rangeWindows(range, now);
    const lastRolled = await lastRolledDay(now);
    const today = lastDays(1, now);

    const [daily, prevDaily, activity, prevActivity, dau, wau, mau, since, statusRows, pendingDocs, aiTodayRows, settings] = await Promise.all([
      dailySeries(current, undefined, lastRolled),
      dailySeries(previous, undefined, lastRolled),
      groupActivity(current, lastRolled),
      groupActivity(previous, lastRolled),
      distinctActiveUsers(today.start),
      distinctActiveUsers(lastDays(7, now).start),
      distinctActiveUsers(lastDays(30, now).start),
      trackingSince(),
      Group.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Group.find({ status: GroupStatus.PENDING }).select(GROUP_FIELDS).sort({ addedAt: 1, createdAt: 1 }).limit(5).lean<LeanGroup[]>(),
      AiCall.aggregate([{ $match: { createdAt: { $gte: today.start } } }, { $group: { _id: null, ...AI_TODAY_GROUP } }]),
      loadAiSettings(),
    ]);

    // "Active groups" counts groups that still exist, so the number matches the list it opens (/groups?activeIn=).
    const existing = await existingGroupIds([...activity.keys(), ...prevActivity.keys()]);
    const onlyExisting = (m: typeof activity) => new Map([...m.entries()].filter(([id]) => existing.has(id)));
    const cur = sumSeries(daily);
    const prev = sumSeries(prevDaily);
    const topActivity = topBy([...activity.entries()], (a) => a.events, 5);
    const topCost = topBy([...activity.entries()], (a) => a.aiCostUsd, 5);
    const refs = await loadGroupRefs([...topActivity, ...topCost].map(([id]) => id));
    const envLimit = (await loadBotRuntime())?.envDailyCallLimit ?? 0;
    const callLimit = settings.dailyCallLimit ?? (envLimit > 0 ? envLimit : null);
    // "Needs attention" must never break the overview: on an error it's left out (the UI then shows nothing).
    const attention = await (async () => {
      const redisOk = await getKv()
        .ping()
        .then(() => true)
        .catch(() => false);
      const report = redisOk ? await readQueue(now.getTime()) : null;
      return loadAttention({ now, callLimit, jobs: report?.queue ? report.jobs : null });
    })().catch((err) => {
      logger.warn(`Couldn't compute the attention list: ${err}`);
      return undefined;
    });

    const body: AdminOverview = {
      range,
      from: current.from,
      to: current.to,
      trackingSince: since,
      kpis: {
        dau,
        wau,
        mau,
        activeGroups: kpi(countActiveGroups(onlyExisting(activity)), countActiveGroups(onlyExisting(prevActivity))),
        tasksCreated: kpi(cur.tasksCreated, prev.tasksCreated),
        aiCalls: kpi(cur.aiCalls, prev.aiCalls),
        aiCostUsd: kpi(cur.aiCostUsd, prev.aiCostUsd),
        mcpCalls: kpi(cur.mcpCalls, prev.mcpCalls),
      },
      aiToday: {
        costUsd: roundUsd(aiTodayRows[0]?.cost ?? 0),
        calls: aiTodayRows[0]?.calls ?? 0,
        blocked: aiTodayRows[0]?.blocked ?? 0,
        budgetUsd: settings.dailyBudgetUsd,
        callLimit,
      },
      groupsByStatus: statusCounts(statusRows),
      pending: await groupRows(pendingDocs, now),
      daily,
      // Deleted groups stay in the lists (as "Deleted group") so the top lists add up with the totals.
      topGroupsByActivity: topActivity.map(([id, a]) => ({ group: refs.get(id) ?? deletedGroupRef(id), events: a.events })),
      topGroupsByAiCost: topCost.map(([id, a]) => ({ group: refs.get(id) ?? deletedGroupRef(id), costUsd: roundUsd(a.aiCostUsd), calls: a.aiCalls })),
      attention,
    };
    res.json({ data: body });
  }),
);
