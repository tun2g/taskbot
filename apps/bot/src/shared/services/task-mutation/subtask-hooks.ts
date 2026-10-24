import { isClosedStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { subtaskService } from 'src/database/services/subtask.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { MutationChannel, refId, taskRefText } from 'src/shared/services/task-mutation/common';
import type { ParentPlan } from 'src/shared/services/task-mutation/subtask-plan';
import { taskSyncService } from 'src/shared/services/task-sync.service';

// What follows a saved change: parent activity rows, parent / child card refreshes, subtasks following
// their parent's epic, a deleted parent's subtasks becoming regular tasks.

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
