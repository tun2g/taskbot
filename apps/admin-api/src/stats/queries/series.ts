/** Windows of days: rolled-up stats_daily rows where the rollup is trusted, live numbers after it. */
import { StatsDaily } from '@tbot/db';
import type { AdminDailyPoint } from '@tbot/shared';
import { Types } from 'mongoose';
import { buildDailySeries, foldGroupActivity, fromStatsDoc, GroupActivity, lastTrustedRollupDay } from 'src/stats/aggregate';
import { addDays, dayOf, DayWindow, windowOf } from 'src/stats/range';

import { liveDayStats } from './live';

/** Newest day the rollup wrote a global row for, capped at yesterday (null = no rollups yet). */
export async function lastRolledDay(now = new Date()): Promise<string | null> {
  const newest = await StatsDaily.findOne({ groupId: null }).sort({ day: -1 }).select('day').lean<{ day: string }>();
  return lastTrustedRollupDay(newest?.day ?? null, dayOf(now));
}

/** Splits a window into the part covered by rollups and the part to compute live. */
function split(window: DayWindow, lastRolled: string | null) {
  const rolledTo = lastRolled && lastRolled >= window.from ? (lastRolled < window.to ? lastRolled : window.to) : null;
  const liveFrom = rolledTo ? addDays(rolledTo, 1) : window.from;
  return { rolledTo, live: liveFrom <= window.to ? windowOf(liveFrom, window.to) : null };
}

/** Daily points for everything (groupId undefined) or for one group. */
export async function dailySeries(window: DayWindow, groupId?: Types.ObjectId, lastRolled?: string | null): Promise<AdminDailyPoint[]> {
  const rolledDay = lastRolled === undefined ? await lastRolledDay() : lastRolled;
  const { rolledTo, live } = split(window, rolledDay);
  const [rolled, liveRows] = await Promise.all([
    rolledTo
      ? StatsDaily.find({ day: { $gte: window.from, $lte: rolledTo }, groupId: groupId ?? null }).lean()
      : Promise.resolve([]),
    live ? liveDayStats(live, groupId ? { groupId } : {}, false) : Promise.resolve([]),
  ]);
  return buildDailySeries(window.days, (rolled as any[]).map(fromStatsDoc), liveRows, rolledDay);
}

/** Per-group activity totals over a window (rollups + live). */
export async function groupActivity(window: DayWindow, lastRolled: string | null): Promise<Map<string, GroupActivity>> {
  const { rolledTo, live } = split(window, lastRolled);
  const [rolled, liveRows] = await Promise.all([
    rolledTo
      ? StatsDaily.find({ day: { $gte: window.from, $lte: rolledTo }, groupId: { $ne: null } })
          .select('day groupId events tasksCreated aiCalls aiCostUsd')
          .lean()
      : Promise.resolve([]),
    live ? liveDayStats(live, {}, true) : Promise.resolve([]),
  ]);
  return foldGroupActivity([...(rolled as any[]).map(fromStatsDoc), ...liveRows]);
}
