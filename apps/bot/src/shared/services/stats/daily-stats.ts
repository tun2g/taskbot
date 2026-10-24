import { TASK_STATUS_LABELS, TaskStatus, UsageKind } from '@tbot/shared';
import mongoose, { PipelineStage } from 'mongoose';
import { AiCall } from 'src/database/models/ai-call.model';
import { StatsDaily } from 'src/database/models/stats-daily.model';
import { TaskActivity } from 'src/database/models/task-activity.model';
import { Task } from 'src/database/models/task.model';
import { UsageEvent } from 'src/database/models/usage-event.model';

/** Group key in the aggregation maps for data with no group (DMs, MCP without a group…): global row only. */
export const NO_GROUP = 'none';

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" (UTC) of a date. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS));
}

export function dayRange(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00Z`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Status-change activities store the label ("✅ Done"); older rows may hold the raw value. */
export const DONE_ACTIVITY_VALUES = [TASK_STATUS_LABELS[TaskStatus.DONE], 'Done', TaskStatus.DONE];

const keyOf = (id: unknown) => (id ? String(id) : NO_GROUP);

// ── Raw per-group aggregates for one day ────────────────────────────────────

export interface UsageCount {
  group: string;
  kind: string;
  channel: string;
  count: number;
}

export interface AiTotals {
  group: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpriced: number;
}

export interface DayAggregates {
  usage: UsageCount[];
  /** Distinct people per group (key NO_GROUP = events without a group). */
  activeUsersByGroup: Record<string, number>;
  /** Distinct people across everything (the global row). */
  activeUsersTotal: number;
  ai: AiTotals[];
  tasksCreated: Record<string, number>;
  tasksCompleted: Record<string, number>;
}

/** Row shape written to stats_daily (groupId null = the global row). */
export interface DailyRow {
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

const emptyRow = (day: string, groupId: string | null): DailyRow => ({
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
});

const roundUsd = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Pure: one row per group seen in any source, plus the global row (groupId null) that sums every group AND
 * the events with no group, with `activeUsers` = distinct people across all of them (not a sum).
 */
export function buildDailyRows(day: string, agg: DayAggregates): DailyRow[] {
  const rows = new Map<string, DailyRow>();
  const row = (key: string) => {
    let r = rows.get(key);
    if (!r) rows.set(key, (r = emptyRow(day, key === NO_GROUP ? null : key)));
    return r;
  };

  for (const u of agg.usage) {
    const r = row(u.group);
    r.events[u.kind] = (r.events[u.kind] ?? 0) + u.count;
    r.channels[u.channel] = (r.channels[u.channel] ?? 0) + u.count;
    if (u.kind === UsageKind.MCP_TOOL) r.mcpCalls += u.count;
    if (u.kind === UsageKind.RATE_LIMITED) r.rateLimited += u.count;
  }
  for (const [group, n] of Object.entries(agg.activeUsersByGroup)) row(group).activeUsers = n;
  for (const a of agg.ai) {
    const r = row(a.group);
    r.aiCalls += a.calls;
    r.aiFailed += a.failed;
    r.aiInputTokens += a.inputTokens;
    r.aiOutputTokens += a.outputTokens;
    r.aiCostUsd = roundUsd(r.aiCostUsd + a.costUsd);
    r.aiUnpriced += a.unpriced;
  }
  for (const [group, n] of Object.entries(agg.tasksCreated)) row(group).tasksCreated += n;
  for (const [group, n] of Object.entries(agg.tasksCompleted)) row(group).tasksCompleted += n;

  const global = emptyRow(day, null);
  for (const r of rows.values()) {
    for (const [k, n] of Object.entries(r.events)) global.events[k] = (global.events[k] ?? 0) + n;
    for (const [k, n] of Object.entries(r.channels)) global.channels[k] = (global.channels[k] ?? 0) + n;
    global.tasksCreated += r.tasksCreated;
    global.tasksCompleted += r.tasksCompleted;
    global.aiCalls += r.aiCalls;
    global.aiFailed += r.aiFailed;
    global.aiInputTokens += r.aiInputTokens;
    global.aiOutputTokens += r.aiOutputTokens;
    global.aiCostUsd = roundUsd(global.aiCostUsd + r.aiCostUsd);
    global.aiUnpriced += r.aiUnpriced;
    global.mcpCalls += r.mcpCalls;
    global.rateLimited += r.rateLimited;
  }
  global.activeUsers = agg.activeUsersTotal;

  rows.delete(NO_GROUP);
  return [...rows.values(), global];
}

// ── Mongo aggregations ──────────────────────────────────────────────────────

type Id = { _id: unknown };

/** Tasks created / completed per group (and per day when `byDay`), from tasks + the activity log. */
export async function aggregateTaskCounts(range: { start?: Date; end?: Date } = {}) {
  const createdAt: Record<string, Date> = {};
  if (range.start) createdAt.$gte = range.start;
  if (range.end) createdAt.$lt = range.end;
  const when = Object.keys(createdAt).length ? { createdAt } : {};
  const byDayGroup = { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, g: '$groupId' };

  const [tasks, createdActs, doneActs] = await Promise.all([
    Task.aggregate<{ _id: { day: string; g: unknown }; n: number }>([
      { $match: when },
      { $group: { _id: byDayGroup, n: { $sum: 1 } } },
    ]),
    TaskActivity.aggregate<{ _id: { day: string; g: unknown }; n: number }>([
      { $match: { ...when, action: 'created' } },
      { $group: { _id: byDayGroup, n: { $sum: 1 } } },
    ]),
    TaskActivity.aggregate<{ _id: { day: string; g: unknown }; n: number }>([
      { $match: { ...when, action: 'status', to: { $in: DONE_ACTIVITY_VALUES } } },
      { $group: { _id: byDayGroup, n: { $sum: 1 } } },
    ]),
  ]);
  return mergeTaskCounts(tasks, createdActs, doneActs);
}

type DayGroupCount = { _id: { day: string; g: unknown }; n: number };

/**
 * Pure: day → group → { created, completed }. "Created" is the larger of the tasks that still exist and the
 * "created" log entries (deleted tasks only survive in the log; tasks older than the log only in `tasks`).
 */
export function mergeTaskCounts(tasks: DayGroupCount[], createdActs: DayGroupCount[], doneActs: DayGroupCount[]) {
  const out: Record<string, Record<string, { created: number; completed: number }>> = {};
  const cell = (day: string, g: unknown) => {
    const byGroup = (out[day] ??= {});
    return (byGroup[keyOf(g)] ??= { created: 0, completed: 0 });
  };
  for (const t of tasks) cell(t._id.day, t._id.g).created = t.n;
  for (const a of createdActs) {
    const c = cell(a._id.day, a._id.g);
    c.created = Math.max(c.created, a.n);
  }
  for (const d of doneActs) cell(d._id.day, d._id.g).completed = d.n;
  return out;
}

/** Everything `buildDailyRows` needs for one UTC day. */
export async function aggregateDay(day: string): Promise<DayAggregates> {
  const { start, end } = dayRange(day);
  const inDay = { createdAt: { $gte: start, $lt: end } };

  const usagePipeline: PipelineStage[] = [
    { $match: inDay },
    { $group: { _id: { g: '$groupId', k: '$kind', c: '$channel' }, n: { $sum: 1 } } },
  ];
  const activePerGroup: PipelineStage[] = [
    { $match: { ...inDay, userId: { $ne: null } } },
    { $group: { _id: { g: '$groupId', u: '$userId' } } },
    { $group: { _id: '$_id.g', n: { $sum: 1 } } },
  ];
  const activeTotal: PipelineStage[] = [
    { $match: { ...inDay, userId: { $ne: null } } },
    { $group: { _id: '$userId' } },
    { $count: 'n' },
  ];
  // 'quota' / 'disabled' rows are refusals (daily cap / AI turned off), not provider calls (they show up as rate_limited events).
  const aiPipeline: PipelineStage[] = [
    { $match: { ...inDay, status: { $nin: ['quota', 'disabled'] } } },
    {
      $group: {
        _id: '$groupId',
        calls: { $sum: 1 },
        failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'invalid']] }, 1, 0] } },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        costUsd: { $sum: '$costUsd' },
        unpriced: { $sum: { $cond: ['$priced', 0, 1] } },
      },
    },
  ];

  const [usage, perGroup, total, ai, tasks] = await Promise.all([
    UsageEvent.aggregate<{ _id: { g: unknown; k: string; c: string }; n: number }>(usagePipeline),
    UsageEvent.aggregate<Id & { n: number }>(activePerGroup),
    UsageEvent.aggregate<{ n: number }>(activeTotal),
    AiCall.aggregate<Id & Omit<AiTotals, 'group'>>(aiPipeline),
    aggregateTaskCounts({ start, end }),
  ]);

  const taskCells = tasks[day] ?? {};
  return {
    usage: usage.map((u) => ({ group: keyOf(u._id.g), kind: u._id.k, channel: u._id.c, count: u.n })),
    activeUsersByGroup: Object.fromEntries(perGroup.map((p) => [keyOf(p._id), p.n])),
    activeUsersTotal: total[0]?.n ?? 0,
    ai: ai.map(({ _id, ...a }) => ({ group: keyOf(_id), ...a })),
    tasksCreated: Object.fromEntries(Object.entries(taskCells).map(([g, c]) => [g, c.created])),
    tasksCompleted: Object.fromEntries(Object.entries(taskCells).map(([g, c]) => [g, c.completed])),
  };
}

const toObjectId = (id: string | null) => (id ? new mongoose.Types.ObjectId(id) : null);

/** Recomputes one day (idempotent: re-running overwrites the day's rows). Returns the rows written. */
export async function rollupDay(day: string): Promise<DailyRow[]> {
  const rows = buildDailyRows(day, await aggregateDay(day));
  await StatsDaily.bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { day, groupId: toObjectId(r.groupId) },
        update: { $set: { ...r, groupId: toObjectId(r.groupId) } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return rows;
}

/**
 * One-off history: tasksCreated / tasksCompleted for every past day from tasks + task_activities. Merges only
 * those two fields, so days that already have rows from real tracking keep their other numbers; new rows get
 * zeros elsewhere (schema defaults).
 */
export async function backfillTaskStats(before?: string): Promise<{ days: number; rows: number }> {
  const counts = await aggregateTaskCounts(before ? { end: dayRange(before).start } : {});
  const ops: Parameters<typeof StatsDaily.bulkWrite>[0] = [];
  const days = Object.keys(counts).sort();
  for (const day of days) {
    let created = 0;
    let completed = 0;
    for (const [group, c] of Object.entries(counts[day])) {
      created += c.created;
      completed += c.completed;
      if (group === NO_GROUP) continue;
      ops.push(backfillOp(day, toObjectId(group), c.created, c.completed));
    }
    ops.push(backfillOp(day, null, created, completed));
  }
  for (let i = 0; i < ops.length; i += 500) await StatsDaily.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  return { days: days.length, rows: ops.length };
}

function backfillOp(day: string, groupId: mongoose.Types.ObjectId | null, tasksCreated: number, tasksCompleted: number) {
  return {
    updateOne: {
      filter: { day, groupId },
      update: { $set: { tasksCreated, tasksCompleted } },
      upsert: true,
    },
  };
}
