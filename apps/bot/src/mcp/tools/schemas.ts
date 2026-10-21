import {
  EPIC_COLOR_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  TASK_TYPE_VALUES,
  TaskStatusCategory,
} from '@tbot/shared';
import { parseDueDate } from 'src/api/validation';
import { z } from 'zod';

export const statusEnum = z
  .enum(TASK_STATUS_VALUES)
  .describe('backlog, todo, in_progress, in_review, pending, done or cancelled.');
export const typeEnum = z.enum(TASK_TYPE_VALUES).describe(`Task type: ${TASK_TYPE_VALUES.join(', ')}.`);
export const priorityEnum = z.enum(TASK_PRIORITY_VALUES).describe(`Priority: ${TASK_PRIORITY_VALUES.join(', ')}.`);
export const categoryEnum = z
  .enum(Object.values(TaskStatusCategory) as [string, ...string[]])
  .describe('Status group: todo (backlog/todo), in_progress (in progress/in review/pending) or done (done/cancelled).');
export const epicColorEnum = z.enum(EPIC_COLOR_VALUES).describe(`Epic color: ${EPIC_COLOR_VALUES.join(', ')}.`);

export const dueDateArg = z
  .string()
  .refine((v) => parseDueDate(v) !== null, 'Use a calendar date as YYYY-MM-DD, e.g. 2026-10-24.')
  .describe('Due date as YYYY-MM-DD (the group’s calendar day).');

export const titleArg = z
  .string()
  .trim()
  .min(1, 'The title is empty.')
  .max(200, 'Titles can be at most 200 characters — move details to the description.')
  .describe('A clean, short work item, e.g. "Fix login redirect on iOS" — not the whole conversation.');

export const descriptionArg = z
  .string()
  .max(2000, 'Descriptions can be at most 2000 characters.')
  .describe('Details, acceptance criteria, links (plain text, max 2000 characters).');

export const assigneeArg = z
  .string()
  .trim()
  .min(1)
  .describe('A group member: "@username", their name, or "me" (see list_members).');

export const epicArg = z
  .string()
  .trim()
  .min(1)
  .describe('An epic of this group: its exact title (case-insensitive) or id.');

export const parentArg = z
  .number()
  .int()
  .positive()
  .describe(
    'Number of the parent task, to make this a subtask of it (e.g. 42 for #42). Subtasks are one level deep and always share the parent\'s epic.',
  );
