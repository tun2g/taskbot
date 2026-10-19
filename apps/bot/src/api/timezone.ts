import { configService } from 'src/configs/configuration';

/**
 * The group's timezone. Groups are created with the model default 'UTC', so that value means
 * "not configured" and falls back to the TIMEZONE env (then UTC).
 */
export function resolveGroupTimezone(groupTimezone?: string | null): string {
  if (groupTimezone && groupTimezone !== 'UTC') return groupTimezone;
  return configService.timezone || 'UTC';
}

/** Today's calendar date `YYYY-MM-DD` in the given timezone (invalid zone → UTC). */
export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Due dates are stored at 00:00Z of their day, so a task is overdue when its dueDate is
 * strictly before 00:00Z of *today in the group's timezone* (on the due day it is "due today").
 */
export function overdueCutoff(timeZone: string, now: Date = new Date()): Date {
  return new Date(`${todayInTimezone(timeZone, now)}T00:00:00.000Z`);
}
