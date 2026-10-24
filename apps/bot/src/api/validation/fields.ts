import {
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
import { parseDueDate } from 'src/api/validation/due-date';

/** "📝 To do" → "To do" — for listing choices in error messages. */
const plain = (label: string) => label.replace(/^[^\p{L}\p{N}]+/u, '').trim();
export const choices = (labels: string[]) => `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;

export const dueDateString = z
  .string()
  .refine((v) => parseDueDate(v) !== null, 'The due date must be a valid date (YYYY-MM-DD).');

export const objectIdString = (message: string) =>
  z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), message);

export const title = z
  .string({ error: 'Please enter a title.' })
  .trim()
  .min(1, 'Please enter a title.')
  .max(200, 'The title must be 200 characters or fewer.');
export const description = z.string().max(2000, 'The description must be 2000 characters or fewer.');
export const status = z.enum(TASK_STATUS_VALUES, {
  error: `Choose a valid status: ${choices(TASK_STATUS_ORDER.map((s) => plain(TASK_STATUS_LABELS[s])))}.`,
});
export const priority = z.enum(TASK_PRIORITY_VALUES, {
  error: `Choose a valid priority: ${choices(TASK_PRIORITY_ORDER.map((p) => plain(TASK_PRIORITY_LABELS[p])))}.`,
});
export const type = z.enum(TASK_TYPE_VALUES, {
  error: `Choose a valid type: ${choices(TASK_TYPE_ORDER.map((t) => plain(TASK_TYPE_LABELS[t])))}.`,
});
export const category = z.enum(Object.values(TaskStatusCategory) as [string, ...string[]], {
  error: 'Choose a valid status group: To do, In progress or Done.',
});
export const assigneeId = objectIdString('The selected assignee could not be found. Please pick someone from the list.');
export const epicId = objectIdString('The selected epic could not be found. Please pick one from the list.');
export const parentTaskId = objectIdString('The parent task could not be found. Please pick a task from the list.');
