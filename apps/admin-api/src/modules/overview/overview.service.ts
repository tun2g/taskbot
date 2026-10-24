import type { AdminOverview, AdminRange } from '@tbot/shared';
import { groupRows } from 'src/modules/groups/groups.service';
import { statusCounts } from 'src/modules/overview/helpers/status-counts';
import { aiTotalsSince, existingGroupIds, groupStatusRows, oldestPendingGroups, redisReachable } from 'src/modules/overview/overview.repository';
import { loadAiSettings } from 'src/modules/settings/settings.service';
import { readQueue } from 'src/modules/system/system.service';
import logger from 'src/shared/logger';
import { deletedGroupRef, loadGroupRefs } from 'src/shared/refs';
import { loadBotRuntime } from 'src/shared/runtime';
import { countActiveGroups, kpi, roundUsd, sumSeries, topBy } from 'src/stats/aggregate';
import { loadAttention } from 'src/stats/attention';
import { dailySeries, distinctActiveUsers, groupActivity, lastRolledDay, trackingSince } from 'src/stats/queries';
import { lastDays, rangeWindows } from 'src/stats/range';

// Tests import the status counter from here.
export { statusCounts } from 'src/modules/overview/helpers/status-counts';

/** GET /overview — KPIs for the range vs the one before, today's AI spend, groups by status and the attention list. */
export async function loadOverview(range: AdminRange): Promise<AdminOverview> {
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
    groupStatusRows(),
    oldestPendingGroups(5),
    aiTotalsSince(today.start),
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
    const redisOk = await redisReachable();
    const report = redisOk ? await readQueue(now.getTime()) : null;
    return loadAttention({ now, callLimit, jobs: report?.queue ? report.jobs : null });
  })().catch((err) => {
    logger.warn(`Couldn't compute the attention list: ${err}`);
    return undefined;
  });

  return {
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
}
