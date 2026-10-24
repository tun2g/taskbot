import { UsageKind } from '@tbot/shared';
import { NO_GROUP } from 'src/shared/services/stats/daily-stats/days';

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

/** Adds every source's numbers to the per-group rows (created on first sight). */
function fillGroupRows(agg: DayAggregates, row: (key: string) => DailyRow): void {
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
}

/** The global row: the sum of every row except `activeUsers`, which the caller sets (distinct people). */
function sumRows(day: string, rows: Iterable<DailyRow>): DailyRow {
  const global = emptyRow(day, null);
  for (const r of rows) {
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
  return global;
}

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

  fillGroupRows(agg, row);
  const global = sumRows(day, rows.values());
  global.activeUsers = agg.activeUsersTotal;

  rows.delete(NO_GROUP);
  return [...rows.values(), global];
}
