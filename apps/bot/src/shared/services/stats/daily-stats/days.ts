import { TASK_STATUS_LABELS, TaskStatus } from '@tbot/shared';

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

/** Map key of a group id (NO_GROUP when there is none). */
export const keyOf = (id: unknown) => (id ? String(id) : NO_GROUP);
