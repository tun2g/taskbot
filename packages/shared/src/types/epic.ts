import type { EpicColor, EpicStatus } from '../constants/epic.js';
import type { UserRef } from './task.js';

/** A group-scoped bucket of related tasks (Jira-style epic). A task belongs to at most one epic. */
export interface IEpic {
  _id: string;
  groupId: string;
  title: string;
  description?: string | null;
  color: EpicColor;
  status: EpicStatus;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
}

/** GET /groups/:groupId/epics — every epic with its task counts (cancelled tasks are excluded from `total`). */
export interface EpicWithProgress extends IEpic {
  progress: {
    total: number;
    done: number;
    inProgress: number;
    /** Cancelled tasks still in the epic (not part of `total`). */
    cancelled: number;
  };
}

export interface CreateEpicInput {
  title: string;
  description?: string;
  /** Omitted → the server picks the least-used color in the group. */
  color?: EpicColor;
  /** Undo of a delete: recreate it already marked done. */
  status?: EpicStatus;
  /** Undo of a delete: put these tasks back (only tasks of this group that have no epic now are linked). */
  taskIds?: string[];
}

export interface UpdateEpicInput {
  title?: string;
  description?: string | null;
  color?: EpicColor;
  status?: EpicStatus;
}

/** DELETE /epics/:epicId — the tasks are kept, just taken out of the epic. */
export interface DeleteEpicResult {
  deleted: boolean;
  /** Tasks that were in the epic (cancelled ones included). */
  tasksUnlinked: number;
  /** Their ids — pass them back in CreateEpicInput.taskIds to undo. */
  taskIds: string[];
}
