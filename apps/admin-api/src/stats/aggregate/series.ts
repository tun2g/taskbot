/** Daily series for the charts: rolled-up days plus live days, and their totals. */
import type { AdminDailyPoint, AdminKpi, UsageChannel } from '@tbot/shared';
import { USAGE_CHANNEL_VALUES } from '@tbot/shared';
import { addDays } from 'src/stats/range';

import { DayStats, emptyDayStats, roundUsd } from './day-stats';

export function toDailyPoint(s: DayStats): AdminDailyPoint {
  const channels: Partial<Record<UsageChannel, number>> = {};
  for (const c of USAGE_CHANNEL_VALUES) if (s.channels[c]) channels[c] = s.channels[c];
  return {
    day: s.day,
    activeUsers: s.activeUsers,
    tasksCreated: s.tasksCreated,
    tasksCompleted: s.tasksCompleted,
    aiCalls: s.aiCalls,
    aiFailed: s.aiFailed,
    aiCostUsd: roundUsd(s.aiCostUsd),
    mcpCalls: s.mcpCalls,
    rateLimited: s.rateLimited,
    channels,
  };
}

/**
 * The last day whose rolled-up stats can be trusted: the newest stats_daily day, but never today
 * (today's row lags behind; today always comes from the raw collections). Null = no rollups yet.
 */
export function lastTrustedRollupDay(newestStatsDay: string | null, today: string): string | null {
  if (!newestStatsDay) return null;
  const yesterday = addDays(today, -1);
  return newestStatsDay < yesterday ? newestStatsDay : yesterday;
}

/**
 * One point per day: rolled-up rows up to `lastRolled`, live rows after it, zeros where neither has data.
 */
export function buildDailySeries(days: string[], rolled: DayStats[], live: DayStats[], lastRolled: string | null): AdminDailyPoint[] {
  const rolledByDay = new Map(rolled.map((r) => [r.day, r]));
  const liveByDay = new Map(live.map((r) => [r.day, r]));
  return days.map((day) => {
    const row = lastRolled && day <= lastRolled ? rolledByDay.get(day) : liveByDay.get(day);
    return toDailyPoint(row ?? emptyDayStats(day));
  });
}

export interface SeriesTotals {
  tasksCreated: number;
  tasksCompleted: number;
  aiCalls: number;
  aiFailed: number;
  aiCostUsd: number;
  mcpCalls: number;
  rateLimited: number;
}

export function sumSeries(points: AdminDailyPoint[]): SeriesTotals {
  const t: SeriesTotals = { tasksCreated: 0, tasksCompleted: 0, aiCalls: 0, aiFailed: 0, aiCostUsd: 0, mcpCalls: 0, rateLimited: 0 };
  for (const p of points) {
    for (const k of Object.keys(t) as (keyof SeriesTotals)[]) t[k] += p[k];
  }
  t.aiCostUsd = roundUsd(t.aiCostUsd);
  return t;
}

export const kpi = (value: number, previous: number): AdminKpi => ({ value: roundUsd(value), previous: roundUsd(previous) });
