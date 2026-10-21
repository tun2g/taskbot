import {
  EPIC_COLOR_EMOJI,
  EpicColor,
  EpicStatus,
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
/** Epic names in one-line labels ("🔵 Login") are cut to this for phone-width lines. */
export const EPIC_LABEL_MAX = 30;
/** Most open epics listed when a requested epic doesn't exist. */
export const MAX_EPIC_SUGGESTIONS = 8;
/** Most epics in the "có những epic nào?" overview. */
export const MAX_EPIC_OVERVIEW = 10;

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

/**
 * When a task is due, in the one wording every surface uses (task card "Due: …", DMs, /ai lists and
 * explanations): "today" / "tomorrow" / "⚠️ overdue since Fri, Oct 16" / "Fri, Oct 23" — null when no date.
 * Closed tasks just show the day.
 */
export function dueWhen(dueDate: Date | string | null | undefined, status: string, today: string): string | null {
  if (!dueDate) return null;
  const day = dayOf(dueDate);
  if (!isClosedStatus(status)) {
    if (day < today) return `⚠️ overdue since ${shortDay(day, today)}`;
    if (day === today) return 'today';
    if (day === addDays(today, 1)) return 'tomorrow';
  }
  return shortDay(day, today);
}

/** "due today" / "due tomorrow" / "⚠️ overdue since Fri, Oct 16" / "due Fri, Oct 23" — null when no date. */
export function dueText(dueDate: Date | string | null | undefined, status: string, today: string): string | null {
  const when = dueWhen(dueDate, status, today);
  if (!when) return null;
  return when.startsWith('⚠️') ? when : `due ${when}`;
}

export function isOverdue(dueDate: Date | string | null | undefined, status: string, today: string): boolean {
  return !!dueDate && !isClosedStatus(status) && dayOf(dueDate) < today;
}

export type Lang = 'vi' | 'en';

const VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/** 'vi' when the text has Vietnamese diacritics. */
export function detectLang(text: string): Lang {
  return VIETNAMESE.test(text) ? 'vi' : 'en';
}

// ── Epics ──

interface EpicLike {
  title: string;
  color?: string | null;
}

/** The colored dot of an epic color (gray for unknown). */
export function epicDot(color?: string | null): string {
  return EPIC_COLOR_EMOJI[color as EpicColor] ?? EPIC_COLOR_EMOJI[EpicColor.GRAY];
}

/** "🔵 Login" — plain (not escaped), title cut for phone width. */
export function epicLabel(epic: EpicLike, max = EPIC_LABEL_MAX): string {
  return `${epicDot(epic.color)} ${shorten(epic.title, max)}`;
}

/** A populated epic ref (`{ title, color }`), else null (bare ids and nulls). */
export function epicOf(ref: unknown): EpicLike | null {
  if (ref && typeof ref === 'object' && 'title' in ref && typeof (ref as EpicLike).title === 'string') {
    return ref as EpicLike;
  }
  return null;
}

/** "🔵 Login — 3/7 done", "🟢 Payments — no tasks yet", closed epics end with ✅. Plain. */
export function epicProgressLine(row: EpicLike & { status?: string; total: number; done: number }): string {
  const progress = row.total ? `${row.done}/${row.total} done` : 'no tasks yet';
  const closed = row.status === EpicStatus.DONE ? ' ✅' : '';
  return `${epicLabel(row, 28)} — ${progress}${closed}`;
}

/** The exact command that creates an epic, as the user would type it in this channel. */
export function createEpicCommand(title: string, channel: 'telegram' | 'web' = 'telegram'): string {
  const words = `tạo epic ${shorten(title, EPIC_LABEL_MAX)}`;
  return channel === 'web' ? words.charAt(0).toUpperCase() + words.slice(1) : `/ai ${words}`;
}

interface StateTask {
  type?: string | null;
  status: string;
  priority?: string | null;
  dueDate?: Date | string | null;
  /** Populated epic ref — adds an "Epic: 🔵 Login" line. */
  epicId?: unknown;
  /** Populated parent ref — adds "🧩 Subtask of #42 Checkout". */
  parentTaskId?: unknown;
}

/**
 * The compact state of one task in two plain lines, same labels as the cards and /ai lists:
 * "🐞 Bug · 🔄 In progress · ⬆️ High" (priority only when high/urgent) and
 * "👤 @an · 📅 due tomorrow" / "👤 Unassigned · ⚠️ overdue since Fri, Oct 16" / "… · 📅 No due date",
 * plus "Epic: 🔵 Login" (as on the card) when the task is in an epic.
 */
/** "2/4 done · 1 cancelled" (cancelled subtasks don't count toward the total); "2 cancelled" when that's all. */
export function subtaskProgressText(p: { total: number; done: number; cancelled?: number }): string {
  const cancelled = p.cancelled ? `${p.cancelled} cancelled` : '';
  if (!p.total) return cancelled;
  return `${p.done}/${p.total} done${cancelled ? ` · ${cancelled}` : ''}`;
}

export function taskStateLines(
  task: StateTask,
  assignee: string | null,
  today: string,
  subtasks?: { total: number; done: number; cancelled?: number } | null,
): string[] {
  const first = [typeText(task.type), statusText(task.status)];
  if (task.priority === 'high' || task.priority === 'urgent') first.push(priorityText(task.priority));
  const due = dueText(task.dueDate, task.status, today);
  const when = due ? (due.startsWith('⚠️') ? due : `📅 ${due}`) : '📅 No due date';
  const lines = [first.join(' · '), `👤 ${assignee ?? 'Unassigned'} · ${when}`];
  const epic = epicOf(task.epicId);
  if (epic) lines.push(`Epic: ${epicLabel(epic)}`);
  const parent = task.parentTaskId as { taskNumber?: number; title?: string } | null | undefined;
  if (parent?.taskNumber) lines.push(`↳ Subtask of #${parent.taskNumber} ${shorten(parent.title ?? '', 40)}`.trimEnd());
  if (subtasks && (subtasks.total || subtasks.cancelled)) lines.push(`🧩 Subtasks: ${subtaskProgressText(subtasks)}`);
  return lines;
}
