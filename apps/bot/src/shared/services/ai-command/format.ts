import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  TaskPriority,
  TaskStatus,
  TaskType,
  isClosedStatus,
} from '@tbot/shared';

// Every /ai reply uses HTML parse mode; all user/AI text goes through escapeHtml.

export const TITLE_MAX = 60;
export const QUERY_LIST_LIMIT = 10;

/** Same escaping as /task replies (task-creation.service), null-safe and dependency-free. */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function shorten(text: string | null | undefined, max = TITLE_MAX): string {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export function statusText(status: string): string {
  return TASK_STATUS_LABELS[status as TaskStatus] ?? TASK_STATUS_LABELS[TaskStatus.TODO];
}

export function typeText(type?: string | null): string {
  return TASK_TYPE_LABELS[(type || 'task') as TaskType] ?? TASK_TYPE_LABELS[TaskType.TASK];
}

export function typeIcon(type?: string | null): string {
  return typeText(type).split(' ')[0];
}

export function priorityText(priority?: string | null): string {
  return TASK_PRIORITY_LABELS[(priority || 'medium') as TaskPriority] ?? TASK_PRIORITY_LABELS[TaskPriority.MEDIUM];
}

/** "Bug" from "🐞 Bug". */
export function labelWord(label: string): string {
  return label.split(' ').slice(1).join(' ');
}

interface NamedUser {
  username?: string | null;
  firstName?: string | null;
}

/** @username, else first name — never an id. Not escaped. */
export function personName(user: NamedUser | null | undefined): string {
  if (!user) return 'someone';
  if (user.username) return `@${user.username}`;
  return user.firstName || 'someone';
}

/** Calendar day stored at 00:00Z → "YYYY-MM-DD". */
export function dayOf(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** "Oct 24" (adds the year when it differs from today's). Formatted in UTC so it never shifts a day. */
export function shortDay(day: string, today: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "due today" / "due tomorrow" / "⚠️ overdue (Fri, Oct 16)" / "due Fri, Oct 23" — null when no date. */
export function dueText(dueDate: Date | string | null | undefined, status: string, today: string): string | null {
  if (!dueDate) return null;
  const day = dayOf(dueDate);
  if (!isClosedStatus(status)) {
    if (day < today) return `⚠️ overdue (${shortDay(day, today)})`;
    if (day === today) return 'due today';
    if (day === addDays(today, 1)) return 'due tomorrow';
  }
  return `due ${shortDay(day, today)}`;
}

export function isOverdue(dueDate: Date | string | null | undefined, status: string, today: string): boolean {
  return !!dueDate && !isClosedStatus(status) && dayOf(dueDate) < today;
}
