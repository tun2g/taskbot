/**
 * Read-only aggregations over the bot's collections. Everything here returns NUMBERS (and ids) only —
 * never task titles, descriptions or message text.
 */
import { AiCall, StatsDaily, Task, UsageEvent } from '@tbot/db';
import { TASK_STATUS_CATEGORY, TaskStatusCategory, UsageKind } from '@tbot/shared';
import { Types } from 'mongoose';
import {
  buildDailySeries,
  DayStats,
  emptyDayStats,
  foldGroupActivity,
  fromStatsDoc,
  GroupActivity,
  lastTrustedRollupDay,
} from 'src/stats/aggregate';
import { addDays, dayOf, DayWindow, windowOf } from 'src/stats/range';
import type { AdminDailyPoint } from '@tbot/shared';

/**
 * Refusals (a daily limit, or AI turned off by the owner) are recorded as ai_calls but never reached the
 * provider: they are not "calls" or "failures" — the same rule as the overview and the bot's stats_daily.
 */
const REFUSALS = ['quota', 'disabled'];
const PROVIDER_CALL = { $cond: [{ $in: ['$status', REFUSALS] }, 0, 1] };
const FAILED_CALL = { $cond: [{ $in: ['$status', ['failed', 'invalid']] }, 1, 0] };
const REFUSED_CALL = { $cond: [{ $in: ['$status', REFUSALS] }, 1, 0] };

const DAY_EXPR = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'UTC' } });

/** Task statuses that count as closed (done / cancelled). */
export const CLOSED_STATUSES = Object.entries(TASK_STATUS_CATEGORY)
  .filter(([, c]) => c === TaskStatusCategory.DONE)
  .map(([s]) => s);

export interface LiveFilter {
  groupId?: Types.ObjectId;
  groupIds?: Types.ObjectId[];
}

function groupMatch(filter: LiveFilter, field = 'groupId'): Record<string, unknown> {
  if (filter.groupId) return { [field]: filter.groupId };
  if (filter.groupIds) return { [field]: { $in: filter.groupIds } };
  return {};
}

const keyOf = (day: string, g: unknown) => `${day}|${g ? String(g) : ''}`;

/**
 * Daily numbers computed from the raw collections for [start, end). perGroup=true gives one row per
 * (day, group); false gives one row per day (activeUsers then counts distinct people across groups).
 */
export async function liveDayStats(window: Pick<DayWindow, 'start' | 'end'>, filter: LiveFilter, perGroup: boolean): Promise<DayStats[]> {
  const range = { $gte: window.start, $lt: window.end };
  const gid = perGroup ? '$groupId' : null;
  const [eventCounts, eventUsers, ai, created, completed] = await Promise.all([
    UsageEvent.aggregate([
      { $match: { createdAt: range, ...groupMatch(filter) } },
      { $group: { _id: { day: DAY_EXPR('createdAt'), g: gid, kind: '$kind', channel: '$channel' }, n: { $sum: 1 } } },
    ]),
    UsageEvent.aggregate([
      { $match: { createdAt: range, userId: { $ne: null }, ...groupMatch(filter) } },
      { $group: { _id: { day: DAY_EXPR('createdAt'), g: gid }, users: { $addToSet: '$userId' } } },
      { $project: { n: { $size: '$users' } } },
    ]),
    AiCall.aggregate([
      { $match: { createdAt: range, ...groupMatch(filter) } },
      {
        $group: {
          _id: { day: DAY_EXPR('createdAt'), g: gid },
          calls: { $sum: PROVIDER_CALL },
          failed: { $sum: FAILED_CALL },
          input: { $sum: '$inputTokens' },
          output: { $sum: '$outputTokens' },
          cost: { $sum: '$costUsd' },
          unpriced: { $sum: { $cond: [{ $or: ['$priced', { $in: ['$status', REFUSALS] }] }, 0, 1] } },
        },
      },
    ]),
    Task.aggregate([
      { $match: { createdAt: range, ...groupMatch(filter) } },
      { $group: { _id: { day: DAY_EXPR('createdAt'), g: gid }, n: { $sum: 1 } } },
    ]),
    Task.aggregate([
      { $match: { completedAt: range, ...groupMatch(filter) } },
      { $group: { _id: { day: DAY_EXPR('completedAt'), g: gid }, n: { $sum: 1 } } },
    ]),
  ]);

  const rows = new Map<string, DayStats>();
  const row = (id: { day: string; g?: unknown }) => {
    const k = keyOf(id.day, id.g);
    let r = rows.get(k);
    if (!r) {
      r = emptyDayStats(id.day, id.g ? String(id.g) : null);
      rows.set(k, r);
    }
    return r;
  };
  for (const e of eventCounts) {
    const r = row(e._id);
    r.events[e._id.kind] = (r.events[e._id.kind] ?? 0) + e.n;
    r.channels[e._id.channel] = (r.channels[e._id.channel] ?? 0) + e.n;
    if (e._id.kind === UsageKind.MCP_TOOL) r.mcpCalls += e.n;
    if (e._id.kind === UsageKind.RATE_LIMITED) r.rateLimited += e.n;
  }
  for (const u of eventUsers) row(u._id).activeUsers = u.n;
  for (const a of ai) {
    const r = row(a._id);
    r.aiCalls = a.calls;
    r.aiFailed = a.failed;
    r.aiInputTokens = a.input;
    r.aiOutputTokens = a.output;
    r.aiCostUsd = a.cost;
    r.aiUnpriced = a.unpriced;
  }
  for (const t of created) row(t._id).tasksCreated = t.n;
  for (const t of completed) row(t._id).tasksCompleted = t.n;
  return [...rows.values()];
}

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

/** Distinct people with any usage event since `since`. */
export async function distinctActiveUsers(since: Date, match: Record<string, unknown> = {}): Promise<number> {
  const res = await UsageEvent.aggregate([
    { $match: { createdAt: { $gte: since }, userId: { $ne: null }, ...match } },
    { $group: { _id: '$userId' } },
    { $count: 'n' },
  ]);
  return res[0]?.n ?? 0;
}

/** First day with any usage / AI tracking (stats start when telemetry was deployed). */
export async function trackingSince(): Promise<string | null> {
  const [stat, event, ai] = await Promise.all([
    StatsDaily.findOne({ $or: [{ activeUsers: { $gt: 0 } }, { aiCalls: { $gt: 0 } }, { mcpCalls: { $gt: 0 } }, { rateLimited: { $gt: 0 } }] })
      .sort({ day: 1 })
      .select('day')
      .lean<{ day: string }>(),
    UsageEvent.findOne().sort({ createdAt: 1 }).select('createdAt').lean<{ createdAt: Date }>(),
    AiCall.findOne().sort({ createdAt: 1 }).select('createdAt').lean<{ createdAt: Date }>(),
  ]);
  const days = [stat?.day, event ? dayOf(event.createdAt) : null, ai ? dayOf(ai.createdAt) : null].filter((d): d is string => !!d).sort();
  return days[0] ?? null;
}

export interface AiTotals {
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpriced: number;
  refused: number;
}

/** AI call totals keyed by `by` (a field path such as "groupId", "userId", "feature", "aiModel" or a day). */
export async function aiTotalsBy(match: Record<string, unknown>, by: string | Record<string, unknown>): Promise<Map<string, AiTotals>> {
  const res = await AiCall.aggregate([
    { $match: match },
    {
      $group: {
        _id: typeof by === 'string' ? `$${by}` : by,
        calls: { $sum: PROVIDER_CALL },
        failed: { $sum: FAILED_CALL },
        refused: { $sum: REFUSED_CALL },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        costUsd: { $sum: '$costUsd' },
        unpriced: { $sum: { $cond: [{ $or: ['$priced', { $in: ['$status', REFUSALS] }] }, 0, 1] } },
      },
    },
  ]);
  return new Map(res.map((r) => [r._id === null || r._id === undefined ? '' : String(r._id), r as AiTotals]));
}

/** Usage event counts keyed by `by` (field path). */
export async function eventCountsBy(match: Record<string, unknown>, by: string | Record<string, unknown>): Promise<Map<string, number>> {
  const res = await UsageEvent.aggregate([{ $match: match }, { $group: { _id: typeof by === 'string' ? `$${by}` : by, n: { $sum: 1 } } }]);
  return new Map(res.map((r) => [r._id === null || r._id === undefined ? '' : String(r._id), r.n as number]));
}

export { DAY_EXPR };
