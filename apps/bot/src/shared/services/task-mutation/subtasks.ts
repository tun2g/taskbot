import { isClosedStatus, SUBTASKS_MAX, TASK_STATUS_LABELS, TaskStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { subtaskService } from 'src/database/services/subtask.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import {
  epicChange,
  MutationChannel,
  refId,
  resolveEpic,
  TaskMutationError,
  taskRefText,
} from 'src/shared/services/task-mutation/common';
import { TaskChange } from 'src/shared/services/task-event-lines';
import { taskSyncService } from 'src/shared/services/task-sync.service';

// Subtask rules for the task mutation service. Subtasks are one level deep (a subtask never has subtasks)
// and always share their parent's epic. Deleting a parent keeps its subtasks as regular tasks.

export const PARENT_NOT_FOUND_MESSAGE = 'That parent task could not be found in this group. Pick a task from the list.';
export const SUBTASK_OF_SELF_MESSAGE = "A task can't be a subtask of itself.";

/** "#13 is already a subtask of #12…" */
export const nestedSubtaskMessage = (parentNumber: number, grandparentNumber: number | null) =>
  grandparentNumber
    ? `#${parentNumber} is already a subtask of #${grandparentNumber}, and subtasks can't have their own subtasks. Add it to #${grandparentNumber} instead.`
    : `#${parentNumber} is already a subtask, and subtasks can't have their own subtasks.`;
export const hasSubtasksMessage = (taskNumber: number, count: number) =>
  `#${taskNumber} has ${count} subtask${count === 1 ? '' : 's'} of its own, so it can't become a subtask. Move or detach them first.`;
export const subtasksFullMessage = (parentNumber: number) =>
  `#${parentNumber} already has ${SUBTASKS_MAX} subtasks, the most a task can have. Group bigger work in an epic instead.`;
export const closedParentMessage = (parentNumber: number, status: string) =>
  `#${parentNumber} is ${statusWord(status)}, so it can't take new subtasks. Reopen it first, or add these as regular tasks.`;
export const subtaskEpicMessage = (parentNumber: number) =>
  `A subtask always stays in its parent's epic. Change the epic on #${parentNumber} instead (its subtasks follow).`;

/** "✅ Done" → "done" */
const statusWord = (status: string) =>
  (TASK_STATUS_LABELS[status as TaskStatus] ?? status).replace(/^[^\p{L}]+/u, '').toLowerCase();

type ParentLike = Pick<ITask, '_id' | 'taskNumber' | 'title' | 'status'>;

function isTaskDoc(value: unknown): value is ParentLike {
  return !!value && typeof value === 'object' && 'taskNumber' in (value as object);
}

/** A subtask's parent (populated ref, or loaded by id), or null. */
async function resolveParent(ref: unknown): Promise<ParentLike | null> {
  if (!ref) return null;
  if (isTaskDoc(ref)) return ref;
  return taskService.getTaskById(refId(ref) as string);
}

/** What an update does to the task's parent; `afterId` is the parent it ends up with (null = regular task). */
export interface ParentPlan {
  prevId: string | null;
  next: ITask | null;
  changed: boolean;
  afterId: string | null;
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

/** Re-renders a parent's group card (its subtask progress changed). Best effort. */
function refreshCard(taskId: unknown): void {
  const id = refId(taskId);
  if (!id) return;
  taskService
    .getTaskById(id)
    .then((task) => (task ? taskSyncService.syncTaskCard(task) : undefined))
    .catch(() => {});
}

function recordOnParent(
  parentId: string,
  groupId: mongoose.Types.ObjectId,
  actor: IUser,
  action: 'subtask_added' | 'subtask_removed',
  child: Pick<ITask, 'taskNumber' | 'title'>,
  channel: MutationChannel,
) {
  return taskActivityService.record({
    taskId: new mongoose.Types.ObjectId(parentId),
    groupId,
    actor: actor._id as mongoose.Types.ObjectId,
    action,
    ...(action === 'subtask_added' ? { to: taskRefText(child) } : { from: taskRefText(child) }),
    via: channel.activity,
  });
}

/** After a subtask is created: log it on the parent and refresh the parent's card. */
export async function afterSubtaskCreated(parent: ITask, task: ITask, actor: IUser, channel: MutationChannel) {
  await recordOnParent(String(parent._id), parent.groupId, actor, 'subtask_added', task, channel);
  refreshCard(parent._id);
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

/**
 * After an update is saved: subtasks follow a parent into its new epic, both parents get a log row when a
 * subtask moves, and parent cards refresh when their progress changed.
 */
export async function afterTaskUpdated(
  before: ITask,
  task: ITask,
  actor: IUser,
  channel: MutationChannel,
  plan: ParentPlan,
  opts: { epicChanged: boolean; newEpicId: mongoose.Types.ObjectId | null; newStatus?: string },
) {
  if (opts.epicChanged && !plan.afterId) {
    const moved = await subtaskService.setEpic(before._id as mongoose.Types.ObjectId, opts.newEpicId);
    if (moved > 0) {
      for (const child of await subtaskService.list(before._id as mongoose.Types.ObjectId)) {
        taskSyncService.syncTaskCard(child).catch(() => {});
      }
    }
  }

  if (plan.changed) {
    if (plan.prevId) {
      await recordOnParent(plan.prevId, before.groupId, actor, 'subtask_removed', task, channel);
      refreshCard(plan.prevId);
    }
    if (plan.next) {
      await recordOnParent(String(plan.next._id), before.groupId, actor, 'subtask_added', task, channel);
      refreshCard(plan.next._id);
    }
  } else if (plan.afterId && opts.newStatus && isClosedStatus(opts.newStatus) !== isClosedStatus(before.status)) {
    // The parent card's "2/5 done" moved.
    refreshCard(plan.afterId);
  }
}

/**
 * After a task is deleted: a subtask is logged on its parent; a parent's subtasks become regular tasks
 * (logged on each, cards refreshed). Returns the detached subtasks.
 */
export async function afterTaskDeleted(task: ITask, actor: IUser, channel: MutationChannel): Promise<ITask[]> {
  const parentId = refId(task.parentTaskId);
  if (parentId) {
    await recordOnParent(parentId, task.groupId, actor, 'subtask_removed', task, channel);
    refreshCard(parentId);
  }

  const detached = (await subtaskService.detachAll(String(task._id))) ?? [];
  await Promise.all(
    detached.map((child) =>
      taskActivityService.record({
        taskId: child._id as mongoose.Types.ObjectId,
        groupId: task.groupId,
        actor: actor._id as mongoose.Types.ObjectId,
        action: 'parent',
        from: taskRefText(task),
        to: null,
        via: channel.activity,
      }),
    ),
  );
  for (const child of detached) refreshCard(child._id);
  return detached;
}
