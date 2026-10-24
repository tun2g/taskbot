/** The mock clock: every fixture time is relative to page load, so screenshots always look "live". */
import type { AdminRange } from '@tbot/shared';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const RANGE_DAYS: Record<AdminRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

export const now = Date.now();
export const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
export const dayStr = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString().slice(0, 10);

/** Stats tracking was deployed 12 days ago — 30d / 90d ranges show the "tracking started" notice. */
export const TRACKING_SINCE_DAYS_AGO = 12;
export const trackingSince = dayStr(TRACKING_SINCE_DAYS_AGO);

/** The days of a range, oldest first (`offset` days earlier = the previous period). */
export function days(range: AdminRange, offset = 0): string[] {
  const n = RANGE_DAYS[range];
  return Array.from({ length: n }, (_, i) => dayStr(n - 1 - i + offset));
}

/** Whether a timestamp falls on one of these days. */
export const inDays = (at: string, list: string[]) => at.slice(0, 10) >= list[0]! && at.slice(0, 10) <= list[list.length - 1]!;

export const inRange = (at: string, range: AdminRange, offset = 0) => inDays(at, days(range, offset));

/** Start of a rolling range, in ms. */
export const since = (range: AdminRange) => now - RANGE_DAYS[range] * DAY;

/** The next time the clock shows `minute` past the hour (UTC). */
export function nextAt(minute: number, from = now): string {
  const d = new Date(from);
  d.setUTCMinutes(minute, 0, 0);
  if (d.getTime() <= from) d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
}
