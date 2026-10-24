import mongoose from 'mongoose';
import { ISourceMessage } from 'src/database/models/task.model';

export interface CreateTaskData {
  groupId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  createdBy: mongoose.Types.ObjectId;
  assigneeId?: mongoose.Types.ObjectId;
  dueDate?: Date;
  epicId?: mongoose.Types.ObjectId | null;
  parentTaskId?: mongoose.Types.ObjectId | null;
  sourceMessage?: ISourceMessage;
  sourceMessages?: ISourceMessage[];
  batchId?: string;
  taskCardChatId?: number;
}

export interface TaskFilters {
  status?: string;
  /** Match any of these statuses (category / open filters); combined with `status` if both are set. */
  statuses?: string[];
  type?: string;
  /** `null` matches unassigned tasks. */
  assigneeId?: mongoose.Types.ObjectId | null;
  priority?: string;
  /** An epic id, or `null` for tasks without an epic. */
  epicId?: mongoose.Types.ObjectId | null;
  /** A task id → its subtasks only; `null` → top-level tasks only (subtasks hidden). */
  parentTaskId?: mongoose.Types.ObjectId | null;
  /** Due date on or after this instant (inclusive). */
  dueFrom?: Date;
  /** Due date strictly before this instant (exclusive). */
  dueTo?: Date;
  /** Only tasks without a due date (ignores dueFrom / dueTo). */
  dueNone?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  /** Order by this field (empty values last); default is newest first. Ties: newest task first. */
  sort?: TaskSortKey;
  dir?: 'asc' | 'desc';
}

export const TASK_SORT_KEYS = ['type', 'key', 'summary', 'status', 'priority', 'assignee', 'due'] as const;
export type TaskSortKey = (typeof TASK_SORT_KEYS)[number];

/** Page size when the caller doesn't pass one. */
export const DEFAULT_TASK_PAGE_SIZE = 50;

/**
 * Default list order. `_id` breaks createdAt ties (bulk-created tasks share a timestamp),
 * so skip/limit pages never skip or repeat a task.
 */
export const TASK_LIST_SORT = { createdAt: -1, _id: -1 } as const;
