import { configService } from 'src/configs/configuration';
import { ITask } from 'src/database/models/task.model';
import { dueWhen } from 'src/shared/services/ai-command/format';

// ── Due dates: a due date is a calendar day stored at 00:00Z ──

export function safeTimezone(tz?: string | null): string {
  const candidate = tz || configService.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

/** Group timezone, falling back to TIMEZONE env (groups are created with the schema default 'UTC'). */
export function groupTimezone(group?: { timezone?: string } | null): string {
  const tz = group?.timezone && group.timezone !== 'UTC' ? group.timezone : configService.timezone;
  return safeTimezone(tz);
}

/** Today's calendar date `YYYY-MM-DD` in the given timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Hour of day (0-23) in the given timezone. */
export function hourIn(timezone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now);
  return parseInt(hour, 10) % 24;
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dueDay(dueDate: Date | string): string {
  return new Date(dueDate).toISOString().slice(0, 10);
}

export function formatDay(dueDate: Date | string): string {
  return new Date(dueDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export type DueState = 'overdue' | 'today' | 'tomorrow' | 'later';

export function dueState(dueDate: Date | string, timezone: string, now: Date = new Date()): DueState {
  const due = dueDay(dueDate);
  const today = todayIn(timezone, now);
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due === addDays(today, 1)) return 'tomorrow';
  return 'later';
}

/**
 * "today" / "tomorrow" / "⚠️ overdue since Fri, Oct 16" / "Fri, Oct 23" — the same wording as DMs and
 * /ai answers (ai-command/format `dueWhen`), with "today" in the group timezone.
 */
export function describeDue(
  task: Pick<ITask, 'dueDate' | 'status'>,
  timezone: string,
  now: Date = new Date(),
): string | null {
  return dueWhen(task.dueDate, task.status, todayIn(timezone, now));
}
