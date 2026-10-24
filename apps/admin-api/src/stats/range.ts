import type { AdminRange } from '@tbot/shared';

export const RANGE_DAYS: Record<AdminRange, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseRange(value: unknown, fallback: AdminRange = '30d'): AdminRange {
  return value === '7d' || value === '30d' || value === '90d' ? value : fallback;
}

/** "YYYY-MM-DD" (UTC) of a date. */
export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 00:00 UTC of a "YYYY-MM-DD" day. */
export function startOfDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, n: number): string {
  return dayOf(new Date(startOfDay(day).getTime() + n * DAY_MS));
}

/** Every day from `from` to `to` inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface DayWindow {
  /** First and last day (inclusive). */
  from: string;
  to: string;
  /** [start, end) instants. */
  start: Date;
  end: Date;
  days: string[];
}

export function windowOf(from: string, to: string): DayWindow {
  return { from, to, start: startOfDay(from), end: startOfDay(addDays(to, 1)), days: daysBetween(from, to) };
}

/** The last N days ending today, and the N days before that (for "vs previous period"). */
export function rangeWindows(range: AdminRange, now = new Date()): { current: DayWindow; previous: DayWindow } {
  const n = RANGE_DAYS[range];
  const to = dayOf(now);
  const from = addDays(to, -(n - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  return { current: windowOf(from, to), previous: windowOf(prevFrom, prevTo) };
}

/** Last N days ending today. */
export function lastDays(n: number, now = new Date()): DayWindow {
  const to = dayOf(now);
  return windowOf(addDays(to, -(n - 1)), to);
}
