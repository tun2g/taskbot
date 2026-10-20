import {
  EPIC_COLOR_EMOJI,
  EpicColor,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_HINTS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TASK_TYPE_HINTS,
  TASK_TYPE_LABELS,
  TASK_TYPE_ORDER,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@tbot/shared';
import { configService } from 'src/configs/configuration';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { dueWhen } from 'src/shared/services/ai-command/format';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { appLinkButton, openTaskLabel } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

// All bot messages use Telegram's legacy `Markdown` parse mode. User text is only ever
// interpolated OUTSIDE entities (never inside *bold*), escaped with `escapeMarkdown`.
// Emoji meanings come from @tbot/shared labels so cards, DMs, digest and /tasks agree.

/** "🔄 In progress" → "In progress" */
function labelWord(label: string): string {
  return label.split(' ').slice(1).join(' ');
}

/** "🔄 In progress" → "🔄" */
function labelEmoji(label: string): string {
  return label.split(' ')[0];
}

export const STATUS_EMOJI: Record<string, string> = Object.fromEntries(
  TASK_STATUS_ORDER.map((status) => [status, labelEmoji(TASK_STATUS_LABELS[status])]),
);

export function statusLabel(status: string): string {
  return TASK_STATUS_LABELS[status as TaskStatus] || TASK_STATUS_LABELS[TaskStatus.TODO];
}

/** "In progress" (no emoji) */
export function statusWord(status: string): string {
  return labelWord(statusLabel(status));
}

export function typeLabel(type?: string | null): string {
  return TASK_TYPE_LABELS[(type || 'task') as TaskType] || TASK_TYPE_LABELS[TaskType.TASK];
}

export function typeEmoji(type?: string | null): string {
  return typeLabel(type).split(' ')[0];
}

export function typeWord(type?: string | null): string {
  return labelWord(typeLabel(type));
}

export function priorityLabel(priority?: string | null): string {
  return TASK_PRIORITY_LABELS[(priority || 'medium') as TaskPriority] || TASK_PRIORITY_LABELS[TaskPriority.MEDIUM];
}

export function priorityWord(priority?: string | null): string {
  return labelWord(priorityLabel(priority));
}

/** Escape user text for legacy Markdown (only `_ * \` [` are special outside entities). */
export function escapeMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  return String(text).replace(/([_*`[])/g, '\\$1');
}

/** Shorten long text for list lines on mobile. */
export function truncate(text: string | null | undefined, max = 60): string {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

type UserLike = Pick<IUser, 'username' | 'firstName'> & { telegramUserId?: number };

/** @username, else first name, else "someone" — never "User 12345". Not escaped. */
export function displayName(user: UserLike | null | undefined): string {
  if (!user) return 'someone';
  if (user.username) return `@${user.username}`;
  return user.firstName || 'someone';
}

/** Escaped display name, ready to drop into a Markdown message. */
export function mdName(user: UserLike | null | undefined): string {
  return escapeMarkdown(displayName(user));
}

/** A populated user ref (from `.populate('createdBy assigneeId')`) or null. */
export function populatedUser(ref: unknown): IUser | null {
  if (ref && typeof ref === 'object' && 'telegramUserId' in (ref as object)) return ref as IUser;
  return null;
}

export function refId(ref: unknown): string | null {
  if (!ref) return null;
  const value = ref as { _id?: { toString(): string }; toString(): string };
  return value._id ? value._id.toString() : value.toString();
}

/** A populated epic ref (`{ _id, title, color }` from TASK_POPULATE) or null. */
export function populatedEpic(ref: unknown): { title: string; color: string } | null {
  if (ref && typeof ref === 'object' && 'title' in (ref as object)) return ref as { title: string; color: string };
  return null;
}

/** "🔵 Login" — the epic as a colored dot + name (escaped, cut for mobile), or null without a (populated) epic. */
export function epicTag(ref: unknown, max = 40): string | null {
  const epic = populatedEpic(ref);
  if (!epic?.title) return null;
  const dot = EPIC_COLOR_EMOJI[epic.color as EpicColor] ?? EPIC_COLOR_EMOJI[EpicColor.GRAY];
  return `${dot} ${escapeMarkdown(truncate(epic.title, max))}`;
}

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

// ── Callback data ──

function generateStorageKey(): string {
  return Math.random().toString(36).substring(2, 10);
}

export async function storeTaskCallbackData(taskId: string, action: string, extra?: Record<string, unknown>): Promise<string> {
  const key = generateStorageKey();
  await callbackDataStorageService.setCallbackData(key, 'task_cb', {
    taskId,
    action,
    ...extra,
  });
  return `task:${action}:${key}`;
}

// ── Card ──

function sourceLine(task: ITask): string | null {
  const source = task.sourceMessages?.length ? task.sourceMessages[0] : task.sourceMessage;
  if (!source) return null;

  const snippet = truncate(source.text, 80);
  const name = (source.fromName || '').replace(/[[\]]/g, '').trim();
  const quote = snippet ? `“${escapeMarkdown(snippet)}”` : '';
  const more = task.sourceMessages && task.sourceMessages.length > 1 ? ` (+${task.sourceMessages.length - 1} more)` : '';

  if (source.link) {
    const label = name ? `From ${name}` : 'Source message';
    return `💬 [${label}](${source.link})${quote ? `: ${quote}` : ''}${more}`;
  }
  if (!quote) return null;
  return `💬 ${name ? `From ${escapeMarkdown(name)}: ` : ''}${quote}${more}`;
}

/**
 * Task card text (legacy Markdown). Creator/assignee fall back to the populated refs on the task.
 * `timezone` decides "Due today" vs overdue (defaults to TIMEZONE env).
 */
export function formatTaskCard(
  task: ITask,
  creatorUser?: IUser | null,
  assigneeUser?: IUser | null,
  timezone?: string,
): string {
  const creator = creatorUser ?? populatedUser(task.createdBy);
  const assignee = assigneeUser ?? populatedUser(task.assigneeId);
  const completer = populatedUser(task.completedBy);
  const tz = safeTimezone(timezone);

  const lines: string[] = [];
  lines.push(`${typeEmoji(task.type)} *${typeWord(task.type)} #${task.taskNumber}* · ${escapeMarkdown(task.title)}`);
  lines.push(`Status: ${statusLabel(task.status)}`);
  lines.push(`Priority: ${priorityLabel(task.priority)}`);
  const epic = epicTag(task.epicId);
  if (epic) lines.push(`Epic: ${epic}`);
  if (assignee) lines.push(`Assignee: ${mdName(assignee)}`);

  const due = describeDue(task, tz);
  if (due) lines.push(`Due: ${due}`);

  if (task.status === TaskStatus.DONE && completer) lines.push(`Done by: ${mdName(completer)}`);
  if (creator) lines.push(`Created by: ${mdName(creator)}`);

  const source = sourceLine(task);
  if (source) lines.push('', source);

  return lines.join('\n');
}

// ── Keyboards (max 3 buttons per row, stable layout) ──

/** Primary next step per status: [status to move to, button text]. */
export const PRIMARY_ACTION: Record<string, { to: string; text: string }> = {
  backlog: { to: 'in_progress', text: '▶ Start' },
  todo: { to: 'in_progress', text: '▶ Start' },
  in_progress: { to: 'in_review', text: '👀 Review' },
  in_review: { to: 'done', text: '✅ Done' },
  pending: { to: 'in_progress', text: '▶ Resume' },
  done: { to: 'todo', text: '🔄 Reopen' },
  cancelled: { to: 'todo', text: '🔄 Reopen' },
};

/** Main card keyboard: [primary next step] [👤 Assign] [⋯ More] / [📱 Open #N] (when the app link exists). */
export async function buildTaskButtons(task: ITask, _userId?: string): Promise<InlineKeyboardButton[][]> {
  const taskId = task._id.toString();
  const primary = PRIMARY_ACTION[task.status] || PRIMARY_ACTION.todo;

  const rows: InlineKeyboardButton[][] = [
    [
      { text: primary.text, callback_data: await storeTaskCallbackData(taskId, 'set_status', { value: primary.to }) },
      { text: '👤 Assign', callback_data: await storeTaskCallbackData(taskId, 'assign') },
      { text: '⋯ More', callback_data: await storeTaskCallbackData(taskId, 'more') },
    ],
  ];
  // Full-width row of its own: easy to hit on a phone, and the action row keeps its layout.
  const open = appLinkButton(openTaskLabel(task.taskNumber), task.groupId, taskId);
  if (open) rows.push([open]);
  return rows;
}

/** "⋯ More" keyboard: [🔁 Status] [🏷 Type] [🔼 Priority] / [💡 Explain] [🗑 Delete] [« Back]. */
export async function buildMoreButtons(task: ITask): Promise<InlineKeyboardButton[][]> {
  const taskId = task._id.toString();
  const rows: InlineKeyboardButton[][] = [
    [
      { text: '🔁 Status', callback_data: await storeTaskCallbackData(taskId, 'status') },
      { text: '🏷 Type', callback_data: await storeTaskCallbackData(taskId, 'type') },
      { text: '🔼 Priority', callback_data: await storeTaskCallbackData(taskId, 'priority') },
    ],
  ];

  rows.push([
    { text: '💡 Explain', callback_data: await storeTaskCallbackData(taskId, 'explain') },
    { text: '🗑 Delete', callback_data: await storeTaskCallbackData(taskId, 'delete') },
    { text: '« Back', callback_data: await storeTaskCallbackData(taskId, 'back') },
  ]);
  return rows;
}

/** Picker with every option (current one marked ✅), two per row, then « Back. */
async function buildPicker(
  task: ITask,
  action: string,
  options: string[],
  current: string,
  label: (value: string) => string,
): Promise<InlineKeyboardButton[][]> {
  const taskId = task._id.toString();
  const rows: InlineKeyboardButton[][] = [];
  let row: InlineKeyboardButton[] = [];
  for (const value of options) {
    const text = value === current ? `✅ ${labelWord(label(value))}` : label(value);
    row.push({ text, callback_data: await storeTaskCallbackData(taskId, action, { value }) });
    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: '« Back', callback_data: await storeTaskCallbackData(taskId, 'more') }]);
  return rows;
}

export function buildPriorityPicker(task: ITask): Promise<InlineKeyboardButton[][]> {
  return buildPicker(task, 'set_priority', TASK_PRIORITY_ORDER, task.priority || 'medium', priorityLabel);
}

export function buildTypePicker(task: ITask): Promise<InlineKeyboardButton[][]> {
  return buildPicker(task, 'set_type', TASK_TYPE_ORDER, task.type || 'task', typeLabel);
}

export function buildStatusPicker(task: ITask): Promise<InlineKeyboardButton[][]> {
  return buildPicker(task, 'set_status', TASK_STATUS_ORDER, task.status || 'todo', statusLabel);
}

/** Legend shown under the card while a status picker is open. */
export function statusPickerText(): string {
  return [
    '🔁 *Move to which status?*',
    ...TASK_STATUS_ORDER.map((s) => `${statusLabel(s)} — ${TASK_STATUS_HINTS[s]}`),
  ].join('\n');
}

/** Legend shown under the card while the type picker is open. */
export function typePickerText(): string {
  return ['🏷 *What kind of task is it?*', ...TASK_TYPE_ORDER.map((t) => `${typeLabel(t)} — ${TASK_TYPE_HINTS[t]}`)].join(
    '\n',
  );
}

/** Delete confirmation: [🗑 Yes, delete] [« Cancel]. */
export async function buildDeleteConfirmButtons(task: ITask): Promise<InlineKeyboardButton[][]> {
  const taskId = task._id.toString();
  return [
    [
      { text: '🗑 Yes, delete', callback_data: await storeTaskCallbackData(taskId, 'delete_confirm') },
      { text: '« Cancel', callback_data: await storeTaskCallbackData(taskId, 'back') },
    ],
  ];
}

export function deleteConfirmText(task: ITask): string {
  return `🗑 *Delete #${task.taskNumber} for everyone?*\nThis removes the task from the board and can't be undone.`;
}
