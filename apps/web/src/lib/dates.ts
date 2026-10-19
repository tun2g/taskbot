import { isClosedStatus, TaskStatus } from '@tbot/shared';

/**
 * Due dates are calendar days. The API sends either `YYYY-MM-DD` or an ISO timestamp at
 * 00:00:00Z of that day — either way the first 10 chars are the day.
 */
export function toDueDay(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null;
  const day = dueDate.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Today's calendar date (`YYYY-MM-DD`) in the given IANA timezone (falls back to UTC). */
export function todayIn(timeZone?: string | null): string {
  const format = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
  try {
    return format(timeZone || 'UTC');
  } catch {
    return format('UTC');
  }
}

/** "Oct 20" (or "Oct 20, 2027" outside the current year), in the browser's locale. */
export function formatDueDate(dueDate: string | null | undefined): string {
  const day = toDueDay(dueDate);
  if (!day) return '';
  const date = new Date(`${day}T00:00:00Z`);
  const sameYear = day.slice(0, 4) === String(new Date().getUTCFullYear());
  return date.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export type DueState = 'none' | 'overdue' | 'today' | 'upcoming';

/** Overdue = due day strictly before today in the group's timezone; done/cancelled tasks are never overdue. */
export function dueState(
  dueDate: string | null | undefined,
  timeZone?: string | null,
  status?: TaskStatus | string,
): DueState {
  const day = toDueDay(dueDate);
  if (!day) return 'none';
  if (status && isClosedStatus(status)) return 'upcoming';
  const today = todayIn(timeZone);
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  return 'upcoming';
}

/** Chip text: "Due today" / "Overdue · Oct 20" / "Oct 20". */
export function dueLabel(dueDate: string | null | undefined, timeZone?: string | null, status?: TaskStatus | string) {
  const state = dueState(dueDate, timeZone, status);
  if (state === 'none') return '';
  if (state === 'today') return 'Due today';
  if (state === 'overdue') return `Overdue · ${formatDueDate(dueDate)}`;
  return formatDueDate(dueDate);
}

/** Full date for meta lines, e.g. "Oct 19, 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "2h ago", "yesterday", … in the browser's locale. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day');
  return formatDate(iso);
}
