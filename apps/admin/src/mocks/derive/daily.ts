/** Daily points (bot-wide or for one group) and the per-group period numbers built from them. */
import type { AdminDailyPoint, AdminGroupPeriodStats, AdminRange } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { aiCalls, dayStr, days, inRange, type MockGroup, groups, noise, refused, TRACKING_SINCE_DAYS_AGO } from '../fixtures';

/** Usage events of one day (all channels). */
export const eventsOf = (d: AdminDailyPoint) => (d.channels.telegram ?? 0) + (d.channels.app ?? 0) + (d.channels.mcp ?? 0);

export function daily(range: AdminRange, scope: { group?: MockGroup }): AdminDailyPoint[] {
  const tracked = dayStr(TRACKING_SINCE_DAYS_AGO);
  const weight = scope.group ? Math.max(0.15, scope.group.seed.aiWeight / 10) : 1;
  const active = scope.group ? scope.group.status === GroupStatus.ACTIVE || scope.group.status === GroupStatus.SUSPENDED : true;
  return days(range).map((day) => {
    const calls = aiCalls.filter((c) => c.at.startsWith(day) && (!scope.group || c.group?.id === scope.group.id));
    const isTracked = day >= tracked;
    const base = active ? 1 : 0;
    const weekday = new Date(day).getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.45 : 1;
    const k = scope.group?.id ?? 'all';
    const scale = (n: number) => Math.round(n * weight * weekend * base);
    const telegram = isTracked ? scale(220 + noise(`${k}t${day}`, 120)) : 0;
    const app = isTracked ? scale(90 + noise(`${k}a${day}`, 60)) : 0;
    const mcp = isTracked ? scale(25 + noise(`${k}m${day}`, 30)) : 0;
    return {
      day,
      activeUsers: isTracked ? Math.max(scope.group ? 0 : 3, scale(14 + noise(`${k}u${day}`, 9))) : 0,
      // Task counts exist before tracking (they come from task documents).
      tasksCreated: scale(9 + noise(`${k}c${day}`, 12)),
      tasksCompleted: scale(6 + noise(`${k}d${day}`, 10)),
      // Like stats_daily: provider calls only (refusals were never sent); "failed" = errors + unusable replies.
      aiCalls: calls.filter((c) => !refused(c.status)).length,
      aiFailed: calls.filter((c) => c.status === 'failed' || c.status === 'invalid').length,
      aiCostUsd: calls.reduce((s, c) => s + c.costUsd, 0),
      mcpCalls: mcp,
      rateLimited: isTracked ? noise(`${k}r${day}`, 4) : 0,
      channels: isTracked ? { telegram, app, mcp } : {},
    };
  });
}

/** Groups with any activity in the period (same rule as the overview's "Active groups"). */
export function activeIn(range: AdminRange): MockGroup[] {
  return groups.filter((g) => daily(range, { group: g }).some((x) => x.tasksCreated + x.aiCalls + eventsOf(x) > 0));
}

export function periodStats(g: MockGroup, range: AdminRange): AdminGroupPeriodStats {
  const d = daily(range, { group: g });
  return {
    events: d.reduce((s, x) => s + eventsOf(x), 0),
    tasksCreated: d.reduce((s, x) => s + x.tasksCreated, 0),
    aiCalls: d.reduce((s, x) => s + x.aiCalls, 0),
    aiCostUsd: d.reduce((s, x) => s + x.aiCostUsd, 0),
    aiUnpriced: aiCalls.filter((c) => c.group?.id === g.id && inRange(c.at, range) && !c.priced).length,
  };
}
