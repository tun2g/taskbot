/** Per-group activity over a window, and the rankings built from it. */
import { DayStats, sumRecord } from './day-stats';

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
