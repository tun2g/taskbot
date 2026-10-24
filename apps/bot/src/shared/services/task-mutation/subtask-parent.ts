import { isClosedStatus, SUBTASKS_MAX } from '@tbot/shared';
import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { subtaskService } from 'src/database/services/subtask.service';
import { taskService } from 'src/database/services/task.service';
import { refId, TaskMutationError } from 'src/shared/services/task-mutation/common';
import {
  closedParentMessage,
  nestedSubtaskMessage,
  PARENT_NOT_FOUND_MESSAGE,
  subtasksFullMessage,
} from 'src/shared/services/task-mutation/subtask-messages';

type ParentLike = Pick<ITask, '_id' | 'taskNumber' | 'title' | 'status'>;

function isTaskDoc(value: unknown): value is ParentLike {
  return !!value && typeof value === 'object' && 'taskNumber' in (value as object);
}

/** A subtask's parent (populated ref, or loaded by id), or null. */
export async function resolveParent(ref: unknown): Promise<ParentLike | null> {
  if (!ref) return null;
  if (isTaskDoc(ref)) return ref;
  return taskService.getTaskById(refId(ref) as string);
}

/**
 * A task that can take one more subtask: in this group, not a subtask itself, still open, below SUBTASKS_MAX.
 * Loaded populated, so callers can copy its epic and refresh its card.
 */
export async function parentOrThrow(groupId: mongoose.Types.ObjectId, parentTaskId: string): Promise<ITask> {
  const parent = mongoose.Types.ObjectId.isValid(parentTaskId) ? await taskService.getTaskById(parentTaskId) : null;
  if (!parent || String(parent.groupId) !== String(groupId)) {
    throw new TaskMutationError('invalid_parent', PARENT_NOT_FOUND_MESSAGE);
  }
  if (parent.parentTaskId) {
    const grandparent = await resolveParent(parent.parentTaskId);
    throw new TaskMutationError('invalid_parent', nestedSubtaskMessage(parent.taskNumber, grandparent?.taskNumber ?? null));
  }
  if (isClosedStatus(parent.status)) {
    throw new TaskMutationError('invalid_parent', closedParentMessage(parent.taskNumber, parent.status));
  }
  if ((await subtaskService.count(parent._id as mongoose.Types.ObjectId)) >= SUBTASKS_MAX) {
    throw new TaskMutationError('invalid_parent', subtasksFullMessage(parent.taskNumber));
  }
  return parent;
}
