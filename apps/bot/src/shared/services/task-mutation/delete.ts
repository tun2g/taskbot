import mongoose from 'mongoose';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { groupService } from 'src/database/services/group.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import {
  APP_CHANNEL,
  clip,
  DELETE_FORBIDDEN_MESSAGE,
  MutationChannel,
  refId,
  TASK_GONE_MESSAGE,
  TaskMutationError,
  viaArg,
} from 'src/shared/services/task-mutation/common';
import { afterTaskDeleted } from 'src/shared/services/task-mutation/subtasks';
import { taskSyncService } from 'src/shared/services/task-sync.service';

/** Only the task's creator or a Telegram admin of its group may delete it. */
async function assertCanDelete(task: ITask, actor: IUser, group: IGroup | null | undefined): Promise<void> {
  const isCreator = refId(task.createdBy) === String(actor._id);
  if (isCreator) return;
  const found = group ?? (await groupService.findGroupById(task.groupId));
  const isAdmin = found ? await isTelegramGroupAdmin(found.telegramGroupId, actor.telegramUserId) : false;
  if (!isAdmin) throw new TaskMutationError('forbidden', DELETE_FORBIDDEN_MESSAGE);
}

/**
 * Deletes a task — its creator or a Telegram admin of the group only. Logs "deleted", removes the card and
 * tells the group. `group` is loaded when not given. A deleted parent's subtasks are kept as regular tasks
 * (`detached` lists them); a deleted subtask is logged on its parent.
 */
export async function deleteTask(
  task: ITask,
  actor: IUser,
  options: { group?: IGroup | null; channel?: MutationChannel } = {},
): Promise<{ detached: ITask[] }> {
  const channel = options.channel ?? APP_CHANNEL;
  await assertCanDelete(task, actor, options.group);

  const deleted = await taskService.deleteTask(String(task._id));
  if (!deleted) throw new TaskMutationError('not_found', TASK_GONE_MESSAGE);

  await taskActivityService.record({
    taskId: task._id as mongoose.Types.ObjectId,
    groupId: task.groupId,
    actor: actor._id as mongoose.Types.ObjectId,
    action: 'deleted',
    from: clip(`#${task.taskNumber} ${task.title}`),
    via: channel.activity,
  });
  taskSyncService.onTaskDeleted(task, actor._id as mongoose.Types.ObjectId, ...viaArg(channel)).catch(() => {});

  const detached = await afterTaskDeleted(task, actor, channel);
  return { detached };
}
