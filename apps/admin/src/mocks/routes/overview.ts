/** GET /overview — the dashboard, computed from the fixtures. */
import type { AdminDailyPoint, AdminOverview, AdminRange } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { attention } from '../derive/attention';
import { activeIn, daily, eventsOf } from '../derive/daily';
import { groupRow, ref } from '../derive/group-row';
import { aiCalls, dayStr, days, groups, inRange, RANGE_DAYS, refused, settings, trackingSince } from '../fixtures';
import { rangeOf, type Route } from '../http';

function topByActivity(range: AdminRange) {
  return groups
    .filter((g) => g.status === GroupStatus.ACTIVE)
    .map((g) => ({ group: ref(g), events: daily(range, { group: g }).reduce((s, d) => s + eventsOf(d), 0) }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 5);
}

function topByAiCost(range: AdminRange) {
  const curCalls = aiCalls.filter((c) => inRange(c.at, range));
  return groups
    .map((g) => {
      const c = curCalls.filter((x) => x.group?.id === g.id);
      return { group: ref(g), costUsd: c.reduce((s, x) => s + x.costUsd, 0), calls: c.length };
    })
    .filter((x) => x.calls > 0)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 5);
}

function aiToday(): AdminOverview['aiToday'] {
  const today = aiCalls.filter((c) => c.at.startsWith(dayStr(0)) && !refused(c.status));
  const blocked = aiCalls.filter((c) => c.at.startsWith(dayStr(0)) && refused(c.status)).length;
  return { costUsd: today.reduce((s, c) => s + c.costUsd, 0), calls: today.length, blocked, budgetUsd: settings.dailyBudgetUsd, callLimit: settings.dailyCallLimit };
}

function kpis(range: AdminRange, cur: AdminDailyPoint[]): AdminOverview['kpis'] {
  const prevCalls = aiCalls.filter((c) => inRange(c.at, range, RANGE_DAYS[range]));
  const curCalls = aiCalls.filter((c) => inRange(c.at, range));
  const sum = (k: keyof AdminDailyPoint) => cur.reduce((s, d) => s + (d[k] as number), 0);
  return {
    dau: 17,
    wau: 41,
    mau: 63,
    activeGroups: { value: activeIn(range).length, previous: range === '7d' ? 5 : 3 },
    tasksCreated: { value: sum('tasksCreated'), previous: Math.round(sum('tasksCreated') * 0.86) },
    aiCalls: { value: curCalls.length, previous: prevCalls.length },
    aiCostUsd: { value: curCalls.reduce((s, c) => s + c.costUsd, 0), previous: prevCalls.reduce((s, c) => s + c.costUsd, 0) },
    mcpCalls: { value: sum('mcpCalls'), previous: Math.round(sum('mcpCalls') * 0.7) },
  };
}

function overview(range: AdminRange): AdminOverview {
  const list = days(range);
  const cur = daily(range, {});
  const byStatus = Object.fromEntries(Object.values(GroupStatus).map((s) => [s, groups.filter((g) => g.status === s).length])) as Record<GroupStatus, number>;
  return {
    range,
    from: list[0]!,
    to: list[list.length - 1]!,
    trackingSince,
    kpis: kpis(range, cur),
    aiToday: aiToday(),
    groupsByStatus: byStatus,
    pending: groups
      .filter((g) => g.status === GroupStatus.PENDING)
      .sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? ''))
      .slice(0, 5)
      .map(groupRow),
    daily: cur,
    topGroupsByActivity: topByActivity(range),
    topGroupsByAiCost: topByAiCost(range),
    attention: attention(),
  };
}

export const overviewRoutes: Route[] = [['GET', /^\/overview$/, ({ q }) => ({ data: overview(rangeOf(q)) })]];
