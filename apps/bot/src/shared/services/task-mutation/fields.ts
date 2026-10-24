import { MutationChannel } from 'src/shared/services/task-mutation/common';

export interface CreateTaskFields {
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  /** User id of a group member. */
  assigneeId?: string;
  /** YYYY-MM-DD (legacy ISO datetimes are cut to their day). */
  dueDate?: string;
  /** Epic id in this group. Ignored for a subtask — it takes its parent's epic. */
  epicId?: string;
  /** Create it as a subtask of this task (same group, not a subtask itself). */
  parentTaskId?: string;
}

export interface UpdateTaskFields {
  title?: string;
  description?: string | null;
  status?: string;
  type?: string;
  priority?: string;
  /** User id, or null / '' to unassign. */
  assigneeId?: string | null;
  /** YYYY-MM-DD, or null / '' to clear. */
  dueDate?: string | null;
  /** Epic id, or null / '' to take the task out of its epic. Refused on a subtask unless it matches the parent's. */
  epicId?: string | null;
  /** Parent task id (make it / move it as a subtask), or null / '' to turn it back into a regular task. */
  parentTaskId?: string | null;
}

export interface CreateTaskOptions {
  channel?: MutationChannel;
  /**
   * 'card' (default): post the task card to the group right away.
   * 'none': the caller posts (e.g. one summary for several tasks).
   */
  announce?: 'card' | 'none';
  /** Tasks created together share a batch id (undo). */
  batchId?: string;
}
