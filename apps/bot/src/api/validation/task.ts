import mongoose from 'mongoose';
import { z } from 'zod';
import {
  assigneeId,
  category,
  description,
  dueDateString,
  epicId,
  parentTaskId,
  priority,
  status,
  title,
  type,
} from 'src/api/validation/fields';

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
