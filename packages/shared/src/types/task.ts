import type { TaskPriority, TaskStatus, TaskStatusCategory, TaskType } from '../constants/task.js';
import type { IEpic } from './epic.js';
import type { IUser } from './user.js';

export interface ISourceMessage {
  messageId: number;
  chatId: number;
  text: string;
  fromUserId: number;
  /** Display name of the message author, snapshotted when the task was created. */
  fromName?: string;
  link: string;
}

/**
 * The API populates user references, so `createdBy` / `assigneeId` arrive as user
 * objects. They can still be bare ids (e.g. right after create), so handle both.
 */
export type UserRef = IUser | string;

export interface ITask {
  _id: string;
  groupId: string;
  title: string;
  description?: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  createdBy: UserRef;
  assigneeId?: UserRef | null;
  dueDate?: string | null;
  taskNumber: number;
  /** Epic the task belongs to — populated as `{ _id, title, color, status }` by the API, a bare id otherwise. */
  epicId?: string | Pick<IEpic, '_id' | 'title' | 'color' | 'status'> | null;
  /**
   * Parent task when this is a subtask — populated as `{ _id, taskNumber, title, status }` by the API, a bare id
   * otherwise. Subtasks are one level deep: a subtask never has subtasks, and it always shares its parent's epic.
   */
  parentTaskId?: string | TaskParentRef | null;
  /** Subtask counts (`done` of `total`, cancelled apart). Set by the API on list/detail/create/update reads; null = no subtasks. */
  subtaskProgress?: SubtaskProgress | null;
  /** All messages the task was generated from (AI extraction can use several). */
  sourceMessages?: ISourceMessage[];
  /** @deprecated kept for tasks created before multi-message extraction; read `sourceMessages` first. */
  sourceMessage?: ISourceMessage | null;
  /** Id shared by every task created in one /task run (used for undo). */
  batchId?: string | null;
  completedAt?: string | null;
  completedBy?: UserRef | null;
  reminderSent?: boolean;
  taskCardMessageId?: number | null;
  taskCardChatId?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** A subtask's parent as the API populates it. */
export type TaskParentRef = Pick<ITask, '_id' | 'taskNumber' | 'title' | 'status'>;

/** Cancelled subtasks are left out of `total` / `done` ("2/4 done") and counted on their own. */
export interface SubtaskProgress {
  /** Subtasks that still count: every status except cancelled. */
  total: number;
  /** Of those, how many are done. */
  done: number;
  cancelled: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  assigneeId?: string;
  /** Calendar date `YYYY-MM-DD` — a due *day*, interpreted in the group's timezone. */
  dueDate?: string;
  /** Ignored for subtasks — a subtask always takes its parent's epic. */
  epicId?: string;
  /** Create it as a subtask of this task (same group; the parent must not be a subtask itself). */
  parentTaskId?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  type?: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  /** Calendar date `YYYY-MM-DD`, or null to clear. */
  dueDate?: string | null;
  /** Epic `_id`, or null to remove the task from its epic. Not allowed on a subtask (it follows its parent). */
  epicId?: string | null;
  /** Parent task `_id` to make it (or move it as) a subtask, or null to turn it back into a regular task. */
  parentTaskId?: string | null;
}

export type TaskDueFilter = 'overdue' | 'today' | 'week' | 'none';

export interface TaskFilters {
  status?: TaskStatus;
  /** All statuses in a Jira-style category (to do / in progress / done). */
  category?: TaskStatusCategory;
  /** true = only tasks that are not closed (done/cancelled). */
  open?: boolean;
  type?: TaskType;
  /** A user `_id`, `"me"` for the caller, or `"none"` for unassigned tasks. */
  assigneeId?: string;
  priority?: TaskPriority;
  /** An epic `_id`, or `"none"` for tasks without an epic. */
  epicId?: string;
  /** A task `_id` → only its subtasks; `"none"` → only top-level tasks (hides subtasks). */
  parentTaskId?: string;
  /**
   * Due-date window, by calendar day in the group's timezone:
   * `overdue` = before today and not closed · `today` · `week` = today … today+6 · `none` = no due date.
   */
  due?: TaskDueFilter;
  search?: string;
  page?: number;
  /** Page size; the API defaults to 20 and caps it at 100. */
  limit?: number;
  /** Order by a list column (empty values last); default is newest first. */
  sort?: TaskSortKey;
  dir?: 'asc' | 'desc';
}

export type TaskSortKey = 'type' | 'key' | 'summary' | 'status' | 'priority' | 'assignee' | 'due';

/** GET /groups/:groupId/tasks/counts — tasks matching the list filters, per status and in total. */
export interface TaskCounts {
  byStatus: Partial<Record<TaskStatus, number>>;
  /** Per assignee user `_id`, plus `"none"` for unassigned (assignee board column headers). */
  byAssignee: Record<string, number>;
  total: number;
}

export interface ITaskActivity {
  _id: string;
  taskId: string;
  actor?: UserRef | null;
  /**
   * created | status | assignee | priority | type | title | description | due_date | epic | deleted
   * | parent (this task became / stopped being a subtask; values are "#12 Title")
   * | subtask_added | subtask_removed (on the parent; values are "#13 Title")
   */
  action: string;
  /** Human-readable values, already formatted for display. */
  from?: string | null;
  to?: string | null;
  /** 'mcp' = an external agent (Claude Code, Cursor, …) via the MCP server. */
  via: 'bot' | 'app' | 'ai' | 'mcp';
  createdAt: string;
}

/** GET /groups/:groupId/stats — a count for every status, plus derived totals. */
export type TaskStats = Record<TaskStatus, number> & {
  overdue: number;
  byCategory: Record<TaskStatusCategory, number>;
};
