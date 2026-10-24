/** One day of numbers (a stats_daily row, or the same computed live) and how to add them up. */

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

/** The numeric fields of DayStats (everything but the day, group and the per-kind / per-channel records). */
const COUNTERS = [
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
] as const;

export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** USD rounded to 6 decimals (sums of tiny per-call costs otherwise print as 0.30000000000000004). */
export const roundUsd = (v: number) => Math.round(v * 1e6) / 1e6;

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
  const out = emptyDayStats(doc.day, doc.groupId ? String(doc.groupId) : null);
  out.events = { ...(doc.events ?? {}) };
  out.channels = { ...(doc.channels ?? {}) };
  for (const k of COUNTERS) out[k] = num(doc[k]);
  return out;
}

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
  for (const k of COUNTERS) out[k] = a[k] + b[k];
  return out;
}
