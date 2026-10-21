import {
  EPIC_COLOR_VALUES,
  EPIC_STATUS_VALUES,
  EPIC_TITLE_MAX,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_ORDER,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TASK_STATUS_VALUES,
  TASK_TYPE_LABELS,
  TASK_TYPE_ORDER,
  TASK_TYPE_VALUES,
  TaskStatusCategory,
} from '@tbot/shared';
import mongoose from 'mongoose';
import { z } from 'zod';

/** "📝 To do" → "To do" — for listing choices in error messages. */
const plain = (label: string) => label.replace(/^[^\p{L}\p{N}]+/u, '').trim();
const choices = (labels: string[]) => `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})T/;

/**
 * A due date is a calendar day. Accepts `YYYY-MM-DD` (preferred) or, for backward compatibility,
 * a full ISO datetime truncated to its date part. Returns a Date at 00:00:00Z of that day, or null if invalid.
 */
export function parseDueDate(value: string): Date | null {
  if (typeof value !== 'string') return null;
  let day = value.trim();
  const prefix = day.match(DATE_PREFIX);
  if (prefix) {
    if (Number.isNaN(Date.parse(day))) return null;
    day = prefix[1];
  }
  const m = day.match(DATE_ONLY);
  if (!m) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject rollovers such as 2026-02-31
  if (date.getUTCFullYear() !== +m[1] || date.getUTCMonth() + 1 !== +m[2] || date.getUTCDate() !== +m[3]) return null;
  return date;
}

/** `YYYY-MM-DD` of a stored due date (always read in UTC so it never shifts a day). */
export function formatDueDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const dueDateString = z
  .string()
  .refine((v) => parseDueDate(v) !== null, 'The due date must be a valid date (YYYY-MM-DD).');

const objectIdString = (message: string) =>
  z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), message);

const title = z
  .string({ error: 'Please enter a title.' })
  .trim()
  .min(1, 'Please enter a title.')
  .max(200, 'The title must be 200 characters or fewer.');
const description = z.string().max(2000, 'The description must be 2000 characters or fewer.');
const status = z.enum(TASK_STATUS_VALUES, {
  error: `Choose a valid status: ${choices(TASK_STATUS_ORDER.map((s) => plain(TASK_STATUS_LABELS[s])))}.`,
});
const priority = z.enum(TASK_PRIORITY_VALUES, {
  error: `Choose a valid priority: ${choices(TASK_PRIORITY_ORDER.map((p) => plain(TASK_PRIORITY_LABELS[p])))}.`,
});
const type = z.enum(TASK_TYPE_VALUES, {
  error: `Choose a valid type: ${choices(TASK_TYPE_ORDER.map((t) => plain(TASK_TYPE_LABELS[t])))}.`,
});
const category = z.enum(Object.values(TaskStatusCategory) as [string, ...string[]], {
  error: 'Choose a valid status group: To do, In progress or Done.',
});
const assigneeId = objectIdString('The selected assignee could not be found. Please pick someone from the list.');
const epicId = objectIdString('The selected epic could not be found. Please pick one from the list.');
const parentTaskId = objectIdString('The parent task could not be found. Please pick a task from the list.');

export const createTaskSchema = z.object({
  title,
  description: description.optional(),
  type: type.optional(),
  priority: priority.optional().default('medium'),
  assigneeId: assigneeId.optional(),
  dueDate: dueDateString.optional(),
  epicId: epicId.optional(),
  /** Create it as a subtask of this task. */
  parentTaskId: parentTaskId.optional(),
});

export const updateTaskSchema = z.object({
  title: title.optional(),
  description: description.nullable().optional(),
  type: type.optional(),
  status: status.optional(),
  priority: priority.optional(),
  assigneeId: assigneeId.nullable().optional(),
  dueDate: dueDateString.nullable().optional(),
  /** null removes the task from its epic. */
  epicId: epicId.nullable().optional(),
  /** null turns a subtask back into a regular task. */
  parentTaskId: parentTaskId.nullable().optional(),
});

/** Largest page GET /groups/:id/tasks returns; bigger `limit`s are capped to it. */
export const TASK_LIST_MAX_LIMIT = 100;
export const TASK_LIST_DEFAULT_LIMIT = 20;

/** List-view sort columns (see taskService.getTasksByGroup). */
export const TASK_LIST_SORTS = ['type', 'key', 'summary', 'status', 'priority', 'assignee', 'due'] as const;

export const TASK_DUE_FILTERS = ['overdue', 'today', 'week', 'none'] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

export const taskQuerySchema = z.object({
  status: status.optional(),
  /** Status category (todo | in_progress | done). */
  category: category.optional(),
  /** `open=true` → only tasks that are not closed (done/cancelled). */
  open: z
    .enum(['true', 'false'], { error: 'The open filter must be true or false.' })
    .optional()
    .transform((v) => v === 'true'),
  type: type.optional(),
  priority: priority.optional(),
  /** A user id, `me` (the caller) or `none` (unassigned). */
  assigneeId: z
    .string()
    .refine(
      (v) => v === 'me' || v === 'none' || mongoose.Types.ObjectId.isValid(v),
      'The assignee filter is invalid. Pick a member, "Mine" or "Unassigned".',
    )
    .optional(),
  /** An epic id or `none` (tasks without an epic). */
  epicId: z
    .string()
    .refine((v) => v === 'none' || mongoose.Types.ObjectId.isValid(v), 'The epic filter is invalid. Pick an epic or "No epic".')
    .optional(),
  /** A task id (its subtasks) or `none` (top-level tasks only — subtasks hidden). */
  parentTaskId: z
    .string()
    .refine((v) => v === 'none' || mongoose.Types.ObjectId.isValid(v), 'The parent filter is invalid. Pick a task or "none".')
    .optional(),
  /** Due-date window, by calendar day in the group's timezone (overdue excludes closed tasks). */
  due: z
    .enum(TASK_DUE_FILTERS, { error: 'The due filter must be overdue, today, week or none.' })
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive('Page must be 1 or more.').optional().default(1),
  limit: z.coerce
    .number()
    .int()
    .positive('Limit must be 1 or more.')
    .optional()
    .default(TASK_LIST_DEFAULT_LIMIT)
    .transform((v) => Math.min(v, TASK_LIST_MAX_LIMIT)),
  /** Order by a list column (default: newest first). */
  sort: z
    .enum(TASK_LIST_SORTS, { error: `Sort by one of: ${TASK_LIST_SORTS.join(', ')}.` })
    .optional(),
  dir: z.enum(['asc', 'desc'], { error: 'The sort direction must be asc or desc.' }).optional(),
});

const epicTitle = z
  .string({ error: 'Please enter an epic name.' })
  .trim()
  .min(1, 'Please enter an epic name.')
  .max(EPIC_TITLE_MAX, `The epic name must be ${EPIC_TITLE_MAX} characters or fewer.`);
const epicColor = z.enum(EPIC_COLOR_VALUES, {
  error: `Choose a valid color: ${choices([...EPIC_COLOR_VALUES])}.`,
});
const epicStatus = z.enum(EPIC_STATUS_VALUES, { error: 'Choose a valid epic status: open or done.' });

/** POST /api/groups/:groupId/epics (CreateEpicInput). */
export const createEpicSchema = z.object({
  title: epicTitle,
  description: description.optional(),
  color: epicColor.optional(),
  /** Undo of a delete: recreate it as it was (open / done)… */
  status: epicStatus.optional(),
  /** …and put its tasks back (only tasks of this group without an epic are linked). */
  taskIds: z
    .array(objectIdString('Some of those tasks could not be found.'), { error: 'taskIds must be a list of task ids.' })
    .max(1000, 'Too many tasks to restore at once.')
    .optional(),
});

/** PATCH /api/epics/:epicId (UpdateEpicInput). */
export const updateEpicSchema = z.object({
  title: epicTitle.optional(),
  description: description.nullable().optional(),
  color: epicColor.optional(),
  status: epicStatus.optional(),
});

export const telegramLoginSchema = z
  .object({
    id: z.number().int(),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    photo_url: z.string().optional(),
    auth_date: z.number().int(),
    hash: z.string(),
  })
  .passthrough();

export const AI_MESSAGE_MAX = 2000;
export const AI_HISTORY_MAX = 20;

/** POST /api/groups/:groupId/ai (AiChatRequest). The server uses only the last 8 history turns. */
export const aiChatSchema = z.object({
  message: z
    .string({ error: 'Please type a message.' })
    .trim()
    .min(1, 'Please type a message.')
    .max(AI_MESSAGE_MAX, `Messages can be at most ${AI_MESSAGE_MAX} characters.`),
  taskId: objectIdString('This task could not be found. Please reopen it and try again.').optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant'], { error: 'The conversation history is invalid.' }),
        content: z.string({ error: 'The conversation history is invalid.' }).max(4000, 'The conversation history is too long.'),
      }),
      { error: 'The conversation history is invalid.' },
    )
    .max(AI_HISTORY_MAX, `The conversation history can have at most ${AI_HISTORY_MAX} messages.`)
    .optional(),
});
