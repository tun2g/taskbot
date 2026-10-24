/**
 * Pure helpers that turn daily stats rows (rolled-up `stats_daily` and live numbers from the raw collections)
 * into the shapes the admin app shows. No database access here — easy to unit test.
 */
import type { AdminAiBreakdownRow, AdminDailyPoint, AdminKpi, UsageChannel } from '@tbot/shared';
import { USAGE_CHANNEL_VALUES } from '@tbot/shared';
import { addDays } from 'src/stats/range';

/** One day of numbers for one group (groupId string) or for everything (null). Same fields as stats_daily. */
export interface DayStats {
  day: string;
  groupId: string | null;
  activeUsers: number;
  events: Record<string, number>;
  channels: Record<string, number>;
  tasksCreated: number;
  tasksCompleted: number;
  aiCalls: number;
  aiFailed: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiCostUsd: number;
  aiUnpriced: number;
  mcpCalls: number;
  rateLimited: number;
}

export function emptyDayStats(day: string, groupId: string | null = null): DayStats {
  return {
    day,
    groupId,
    activeUsers: 0,
    events: {},
    channels: {},
    tasksCreated: 0,
    tasksCompleted: 0,
    aiCalls: 0,
    aiFailed: 0,
    aiInputTokens: 0,
    aiOutputTokens: 0,
    aiCostUsd: 0,
    aiUnpriced: 0,
    mcpCalls: 0,
    rateLimited: 0,
  };
}

/** Normalises a stats_daily document (missing fields → 0). */
export function fromStatsDoc(doc: Partial<DayStats> & { day: string; groupId?: unknown }): DayStats {
  const base = emptyDayStats(doc.day, doc.groupId ? String(doc.groupId) : null);
  return {
    ...base,
    activeUsers: num(doc.activeUsers),
    events: { ...(doc.events ?? {}) },
    channels: { ...(doc.channels ?? {}) },
    tasksCreated: num(doc.tasksCreated),
    tasksCompleted: num(doc.tasksCompleted),
    aiCalls: num(doc.aiCalls),
    aiFailed: num(doc.aiFailed),
    aiInputTokens: num(doc.aiInputTokens),
    aiOutputTokens: num(doc.aiOutputTokens),
    aiCostUsd: num(doc.aiCostUsd),
    aiUnpriced: num(doc.aiUnpriced),
    mcpCalls: num(doc.mcpCalls),
    rateLimited: num(doc.rateLimited),
  };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** USD rounded to 6 decimals (sums of tiny per-call costs otherwise print as 0.30000000000000004). */
export const roundUsd = (v: number) => Math.round(v * 1e6) / 1e6;

export function sumRecord(record: Record<string, number> | null | undefined): number {
  return Object.values(record ?? {}).reduce((a, b) => a + num(b), 0);
}

function addRecord(into: Record<string, number>, from: Record<string, number>) {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + num(v);
}

/** Adds `b` into `a` (activeUsers too — only meaningful when the rows are for different groups of one day). */
export function addDayStats(a: DayStats, b: DayStats): DayStats {
  const out = { ...a, events: { ...a.events }, channels: { ...a.channels } };
  addRecord(out.events, b.events);
  addRecord(out.channels, b.channels);
  for (const k of [
    'activeUsers',
    'tasksCreated',
    'tasksCompleted',
    'aiCalls',
    'aiFailed',
    'aiInputTokens',
    'aiOutputTokens',
    'aiCostUsd',
    'aiUnpriced',
    'mcpCalls',
    'rateLimited',
  ] as const) {
    out[k] = a[k] + b[k];
  }
  return out;
}

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
    t.tasksCreated += p.tasksCreated;
    t.tasksCompleted += p.tasksCompleted;
    t.aiCalls += p.aiCalls;
    t.aiFailed += p.aiFailed;
    t.aiCostUsd += p.aiCostUsd;
    t.mcpCalls += p.mcpCalls;
    t.rateLimited += p.rateLimited;
  }
  t.aiCostUsd = roundUsd(t.aiCostUsd);
  return t;
}

export const kpi = (value: number, previous: number): AdminKpi => ({ value: roundUsd(value), previous: roundUsd(previous) });

/** Per-group activity over a window, combined from rolled and live rows. */
export interface GroupActivity {
  events: number;
  aiCalls: number;
  aiCostUsd: number;
  tasksCreated: number;
}

export function foldGroupActivity(rows: DayStats[]): Map<string, GroupActivity> {
  const out = new Map<string, GroupActivity>();
  for (const r of rows) {
    if (!r.groupId) continue;
    const cur = out.get(r.groupId) ?? { events: 0, aiCalls: 0, aiCostUsd: 0, tasksCreated: 0 };
    cur.events += sumRecord(r.events);
    cur.aiCalls += r.aiCalls;
    cur.aiCostUsd += r.aiCostUsd;
    cur.tasksCreated += r.tasksCreated;
    out.set(r.groupId, cur);
  }
  return out;
}

/** A group counts as active in a window when it had any activity (requests, tasks created or AI calls). */
export const isActive = (a: GroupActivity) => a.events + a.tasksCreated + a.aiCalls > 0;

/** Groups with any activity (events, tasks or AI) in the window. */
export function countActiveGroups(activity: Map<string, GroupActivity>): number {
  let n = 0;
  for (const a of activity.values()) if (isActive(a)) n++;
  return n;
}

export function topBy<T>(entries: [string, T][], score: (v: T) => number, limit: number): [string, T][] {
  return entries
    .filter(([, v]) => score(v) > 0)
    .sort((a, b) => score(b[1]) - score(a[1]))
    .slice(0, limit);
}

/** Totals of breakdown rows (for AdminAiUsage.totals). */
export function sumBreakdown(rows: AdminAiBreakdownRow[]): Omit<AdminAiBreakdownRow, 'key' | 'label'> {
  const t = { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0 };
  for (const r of rows) {
    t.calls += r.calls;
    t.failed += r.failed;
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.costUsd += r.costUsd;
    t.unpriced += r.unpriced;
  }
  t.costUsd = roundUsd(t.costUsd);
  return t;
}

/** Earliest of several "YYYY-MM-DD" days (nulls ignored). */
export function earliestDay(...days: (string | null | undefined)[]): string | null {
  const real = days.filter((d): d is string => !!d).sort();
  return real[0] ?? null;
}

/** "An Nguyen" / "@an" / "User 123" — a display name from a users row. */
export function personName(u: { firstName?: string | null; lastName?: string | null; username?: string | null; telegramUserId: number }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (u.username) return `@${u.username}`;
  return `User ${u.telegramUserId}`;
}
