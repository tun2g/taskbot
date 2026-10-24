import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
import {
  APP_CHANNEL,
  epicChange,
  MutationChannel,
  refId,
  resolveEpic,
  TASK_GONE_MESSAGE,
  TaskMutationError,
  viaArg,
} from 'src/shared/services/task-mutation/common';
import { UpdateTaskFields } from 'src/shared/services/task-mutation/fields';
import { epicOrThrow } from 'src/shared/services/task-mutation/guards';
import { afterTaskUpdated, planParentChange } from 'src/shared/services/task-mutation/subtasks';
import { FieldPlan, planFieldChanges } from 'src/shared/services/task-mutation/update-fields';
import { TaskChange, taskSyncService } from 'src/shared/services/task-sync.service';

function notifyUnassigned(task: ITask, previous: IUser, changedBy: IUser) {
  // Provided by the notification service when available.
  const svc = notificationService as typeof notificationService & {
    notifyUnassigned?: (task: ITask, previous: IUser, changedBy: IUser) => Promise<void>;
  };
  if (typeof svc.notifyUnassigned === 'function') {
    svc.notifyUnassigned(task, previous, changedBy).catch(() => {});
  }
}

/** Writes the status (with its completion stamp) and the other fields; throws when the task is gone. */
async function saveTask(taskId: string, before: ITask, actor: IUser, plan: FieldPlan): Promise<ITask> {
  let task: ITask | null = before;
  if (plan.newStatus) {
    task = await taskService.updateTaskStatus(taskId, plan.newStatus, actor._id as mongoose.Types.ObjectId);
  }
  if (task && Object.keys(plan.updates).length > 0) {
    task = await taskService.updateTask(taskId, plan.updates);
  }
  if (!task) throw new TaskMutationError('not_found', TASK_GONE_MESSAGE);
  return task;
}

function recordChanges(before: ITask, actor: IUser, changes: TaskChange[], channel: MutationChannel) {
  return Promise.all(
    changes.map((change) =>
      taskActivityService.record({
        taskId: before._id as mongoose.Types.ObjectId,
        groupId: before.groupId,
        actor: actor._id as mongoose.Types.ObjectId,
        action: change.field,
        from: change.from,
        to: change.to,
        via: channel.activity,
      }),
    ),
  );
}

/** DMs — same behaviour as changes made in the bot. */
function notifyPeople(updatedTask: ITask, actor: IUser, plan: FieldPlan) {
  const { assigneeChanged, newAssignee, previousAssignee, newStatus } = plan;
  if (assigneeChanged) {
    if (newAssignee) notificationService.notifyAssignment(updatedTask, newAssignee, actor).catch(() => {});
    if (previousAssignee) notifyUnassigned(updatedTask, previousAssignee, actor);
  }
  if (newStatus) {
    const currentAssignee = assigneeChanged ? newAssignee : previousAssignee;
    if (currentAssignee && String(currentAssignee._id) !== String(actor._id)) {
      notificationService.notifyStatusChange(updatedTask, actor, currentAssignee).catch(() => {});
    }
  }
}

/**
 * Applies only the fields that actually changed: writes them, logs one activity row per field, DMs the
 * (new / previous) assignee, refreshes the card and posts one change line. Returns `before` untouched (and
 * `changes` empty) when nothing changed.
 */
export async function updateTask(
  before: ITask,
  actor: IUser,
  data: UpdateTaskFields,
  channel: MutationChannel = APP_CHANNEL,
): Promise<{ task: ITask; changes: TaskChange[] }> {
  const taskId = String(before._id);
  const plan = await planFieldChanges(before, data);
  const { changes, updates, newStatus } = plan;

  const parentPlan = await planParentChange(before, data, updates, changes);

  // A plain epic change — only for a regular task (a subtask's epic follows its parent, see planParentChange).
  let epicChanged = false;
  if (data.epicId !== undefined && !parentPlan.afterId) {
    const nextId = data.epicId || null;
    if (nextId !== refId(before.epicId)) {
      const nextEpic = nextId ? await epicOrThrow(before.groupId, nextId) : null;
      epicChanged = true;
      updates.epicId = nextEpic ? nextEpic._id : null;
      changes.push(epicChange(await resolveEpic(before.epicId), nextEpic));
    }
  }

  if (changes.length === 0) return { task: before, changes };

  const task = await saveTask(taskId, before, actor, plan);
  await recordChanges(before, actor, changes, channel);

  await afterTaskUpdated(before, task, actor, channel, parentPlan, {
    epicChanged,
    newEpicId: (updates.epicId as mongoose.Types.ObjectId | null | undefined) ?? null,
    newStatus,
  });

  const updatedTask = task;
  notifyPeople(updatedTask, actor, plan);

  taskSyncService.syncTaskCard(updatedTask).catch(() => {});
  taskSyncService
    .postChangeSummary(updatedTask, actor._id as mongoose.Types.ObjectId, changes, ...viaArg(channel))
    .catch(() => {});

  return { task: updatedTask, changes };
}
