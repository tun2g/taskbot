import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { subtaskService } from 'src/database/services/subtask.service';
import { epicChange, refId, resolveEpic, TaskMutationError, taskRefText } from 'src/shared/services/task-mutation/common';
import {
  hasSubtasksMessage,
  SUBTASK_OF_SELF_MESSAGE,
  subtaskEpicMessage,
} from 'src/shared/services/task-mutation/subtask-messages';
import { parentOrThrow, resolveParent } from 'src/shared/services/task-mutation/subtask-parent';
import { TaskChange } from 'src/shared/services/task-event-lines';

/** What an update does to the task's parent; `afterId` is the parent it ends up with (null = regular task). */
export interface ParentPlan {
  prevId: string | null;
  next: ITask | null;
  changed: boolean;
  afterId: string | null;
}

/**
 * Plans the parent / epic part of an update, adding to `updates` / `changes`:
 * - `parentTaskId` set → validates and moves the task into the parent's epic;
 * - `epicId` on a subtask → refused unless it's the parent's epic already (a no-op).
 * The caller handles a plain epic change only when `afterId` is null.
 */
export async function planParentChange(
  before: ITask,
  data: { parentTaskId?: string | null; epicId?: string | null },
  updates: Record<string, unknown>,
  changes: TaskChange[],
): Promise<ParentPlan> {
  const taskId = String(before._id);
  const prevId = refId(before.parentTaskId);
  let next: ITask | null = null;
  let changed = false;

  if (data.parentTaskId !== undefined) {
    const nextId = data.parentTaskId || null;
    if (nextId !== prevId) {
      if (nextId) {
        if (nextId === taskId) throw new TaskMutationError('invalid_parent', SUBTASK_OF_SELF_MESSAGE);
        const own = await subtaskService.count(taskId);
        if (own > 0) throw new TaskMutationError('invalid_parent', hasSubtasksMessage(before.taskNumber, own));
        next = await parentOrThrow(before.groupId, nextId);
      }
      const prev = await resolveParent(before.parentTaskId);
      changed = true;
      updates.parentTaskId = next ? next._id : null;
      changes.push({ field: 'parent', from: prev ? taskRefText(prev) : null, to: next ? taskRefText(next) : null });
    }
  }
  const afterId = changed ? (next ? String(next._id) : null) : prevId;

  if (next) {
    // Joining a parent moves the task into the parent's epic.
    const parentEpicId = refId(next.epicId);
    if (parentEpicId !== refId(before.epicId)) {
      updates.epicId = parentEpicId ? new mongoose.Types.ObjectId(parentEpicId) : null;
      changes.push(epicChange(await resolveEpic(before.epicId), await resolveEpic(next.epicId)));
    }
  } else if (afterId && data.epicId !== undefined && (data.epicId || null) !== refId(before.epicId)) {
    const parent = await resolveParent(before.parentTaskId);
    throw new TaskMutationError('invalid_parent', subtaskEpicMessage(parent?.taskNumber ?? 0));
  }

  return { prevId, next, changed, afterId };
}
