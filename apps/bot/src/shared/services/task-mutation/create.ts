import mongoose from 'mongoose';
import { parseDueDate } from 'src/api/validation';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
import { APP_CHANNEL, clip, refId } from 'src/shared/services/task-mutation/common';
import { CreateTaskFields, CreateTaskOptions } from 'src/shared/services/task-mutation/fields';
import { epicOrThrow, memberOrThrow } from 'src/shared/services/task-mutation/guards';
import { afterSubtaskCreated, parentOrThrow } from 'src/shared/services/task-mutation/subtasks';
import { taskSyncService } from 'src/shared/services/task-sync.service';

/** The new task's epic: a subtask always lives in its parent's epic, else the validated `epicId`. */
async function epicIdFor(
  groupId: mongoose.Types.ObjectId,
  data: CreateTaskFields,
  parent: ITask | null,
): Promise<mongoose.Types.ObjectId | undefined> {
  const epic = !parent && data.epicId ? await epicOrThrow(groupId, data.epicId) : null;
  const parentEpicId = parent ? refId(parent.epicId) : null;
  return parentEpicId
    ? new mongoose.Types.ObjectId(parentEpicId)
    : epic
      ? (epic._id as mongoose.Types.ObjectId)
      : undefined;
}

/**
 * Creates a task in the group: validates assignee / epic, records "created", DMs the assignee and (by default)
 * posts the card to the group.
 */
export async function createTask(
  group: IGroup,
  actor: IUser,
  data: CreateTaskFields,
  options: CreateTaskOptions = {},
): Promise<{ task: ITask; assignee: IUser | null }> {
  const channel = options.channel ?? APP_CHANNEL;
  const groupId = group._id as mongoose.Types.ObjectId;

  const assignee = data.assigneeId ? await memberOrThrow(groupId, data.assigneeId) : null;
  const parent = data.parentTaskId ? await parentOrThrow(groupId, data.parentTaskId) : null;
  const epicId = await epicIdFor(groupId, data, parent);

  const task = await taskService.createTask({
    groupId,
    createdBy: actor._id as mongoose.Types.ObjectId,
    title: data.title,
    description: data.description,
    type: data.type,
    priority: data.priority,
    assigneeId: data.assigneeId ? new mongoose.Types.ObjectId(data.assigneeId) : undefined,
    dueDate: data.dueDate ? (parseDueDate(data.dueDate) ?? undefined) : undefined,
    epicId,
    ...(parent ? { parentTaskId: parent._id as mongoose.Types.ObjectId } : {}),
    ...(options.batchId ? { batchId: options.batchId } : {}),
    // So the card is posted to the group
    taskCardChatId: group.telegramGroupId,
  });

  await taskActivityService.record({
    taskId: task._id as mongoose.Types.ObjectId,
    groupId,
    actor: actor._id as mongoose.Types.ObjectId,
    action: 'created',
    to: clip(task.title),
    via: channel.activity,
  });
  if (parent) await afterSubtaskCreated(parent, task, actor, channel);

  if (assignee) {
    notificationService.notifyAssignment(task, assignee, actor).catch(() => {});
  }
  if ((options.announce ?? 'card') === 'card') {
    taskSyncService.syncTaskCard(task, { created: true, via: channel.label ?? 'app' }).catch(() => {});
  }
  return { task, assignee };
}
