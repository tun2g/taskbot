import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@tbot/shared';
import mongoose from 'mongoose';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { formatDueDate, parseDueDate } from 'src/api/validation';
import { IEpic } from 'src/database/models/epic.model';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import { epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
import {
  APP_CHANNEL,
  ASSIGNEE_NOT_MEMBER_MESSAGE,
  clip,
  DELETE_FORBIDDEN_MESSAGE,
  EPIC_NOT_IN_GROUP_MESSAGE,
  epicChange,
  MutationChannel,
  refId,
  resolveEpic,
  resolveUser,
  TASK_GONE_MESSAGE,
  TaskMutationError,
  viaArg,
} from 'src/shared/services/task-mutation/common';
import {
  afterSubtaskCreated,
  afterTaskDeleted,
  afterTaskUpdated,
  parentOrThrow,
  planParentChange,
} from 'src/shared/services/task-mutation/subtasks';
import { TaskChange, taskSyncService, userDisplayName } from 'src/shared/services/task-sync.service';

// The one place where a task is created / changed / deleted on behalf of a person from outside the chat
// (the REST API for the Mini App, the MCP server). Every caller gets the same validation, activity log,
// DMs to assignees and group card / change line. Subtask rules live in ./task-mutation/subtasks.

export {
  APP_CHANNEL,
  ASSIGNEE_NOT_MEMBER_MESSAGE,
  DELETE_FORBIDDEN_MESSAGE,
  EPIC_NOT_IN_GROUP_MESSAGE,
  refId,
  TASK_GONE_MESSAGE,
  TaskMutationError,
};
export type { MutationChannel, TaskMutationErrorCode } from 'src/shared/services/task-mutation/common';

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

const statusLabel = (s: string) => TASK_STATUS_LABELS[s as TaskStatus] ?? s;
const priorityLabel = (p: string) => TASK_PRIORITY_LABELS[p as TaskPriority] ?? p;
const typeLabel = (t: string) => TASK_TYPE_LABELS[t as TaskType] ?? t;

function notifyUnassigned(task: ITask, previous: IUser, changedBy: IUser) {
  // Provided by the notification service when available.
  const svc = notificationService as typeof notificationService & {
    notifyUnassigned?: (task: ITask, previous: IUser, changedBy: IUser) => Promise<void>;
  };
  if (typeof svc.notifyUnassigned === 'function') {
    svc.notifyUnassigned(task, previous, changedBy).catch(() => {});
  }
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

export class TaskMutationService {
  /** A group member as the assignee, or a TaskMutationError. */
  private async memberOrThrow(groupId: mongoose.Types.ObjectId, userId: string): Promise<IUser> {
    const isMember = await groupMemberService.isMember(groupId, userId);
    const user = isMember ? await User.findById(userId) : null;
    if (!user) throw new TaskMutationError('assignee_not_member', ASSIGNEE_NOT_MEMBER_MESSAGE);
    return user;
  }

  private async epicOrThrow(groupId: mongoose.Types.ObjectId, epicId: string): Promise<IEpic> {
    const epic = await epicService.findInGroup(groupId, epicId);
    if (!epic) throw new TaskMutationError('epic_not_in_group', EPIC_NOT_IN_GROUP_MESSAGE);
    return epic;
  }

  /**
   * Creates a task in the group: validates assignee / epic, records "created", DMs the assignee and (by default)
   * posts the card to the group.
   */
  async createTask(
    group: IGroup,
    actor: IUser,
    data: CreateTaskFields,
    options: CreateTaskOptions = {},
  ): Promise<{ task: ITask; assignee: IUser | null }> {
    const channel = options.channel ?? APP_CHANNEL;
    const groupId = group._id as mongoose.Types.ObjectId;

    const assignee = data.assigneeId ? await this.memberOrThrow(groupId, data.assigneeId) : null;
    const parent = data.parentTaskId ? await parentOrThrow(groupId, data.parentTaskId) : null;
    // A subtask always lives in its parent's epic.
    const epic = !parent && data.epicId ? await this.epicOrThrow(groupId, data.epicId) : null;
    const parentEpicId = parent ? refId(parent.epicId) : null;
    const epicId = parentEpicId
      ? new mongoose.Types.ObjectId(parentEpicId)
      : epic
        ? (epic._id as mongoose.Types.ObjectId)
        : undefined;

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

  /**
   * Applies only the fields that actually changed: writes them, logs one activity row per field, DMs the
   * (new / previous) assignee, refreshes the card and posts one change line. Returns `before` untouched (and
   * `changes` empty) when nothing changed.
   */
  async updateTask(
    before: ITask,
    actor: IUser,
    data: UpdateTaskFields,
    channel: MutationChannel = APP_CHANNEL,
  ): Promise<{ task: ITask; changes: TaskChange[] }> {
    const taskId = String(before._id);
    const changes: TaskChange[] = [];
    const updates: Record<string, unknown> = {};
    let newStatus: string | undefined;

    if (data.status !== undefined && data.status !== before.status) {
      newStatus = data.status;
      changes.push({ field: 'status', from: statusLabel(before.status), to: statusLabel(data.status) });
    }

    const previousAssignee = await resolveUser(before.assigneeId);
    let newAssignee: IUser | null = null;
    let assigneeChanged = false;
    if (data.assigneeId !== undefined) {
      const nextId = data.assigneeId || null;
      if (nextId !== refId(before.assigneeId)) {
        if (nextId) newAssignee = await this.memberOrThrow(before.groupId, nextId);
        assigneeChanged = true;
        updates.assigneeId = nextId ? new mongoose.Types.ObjectId(nextId) : null;
        changes.push({
          field: 'assignee',
          from: previousAssignee ? userDisplayName(previousAssignee) : null,
          to: newAssignee ? userDisplayName(newAssignee) : null,
        });
      }
    }

    if (data.title !== undefined && data.title !== before.title) {
      updates.title = data.title;
      changes.push({ field: 'title', from: clip(before.title), to: clip(data.title) });
    }

    if (data.priority !== undefined && data.priority !== before.priority) {
      updates.priority = data.priority;
      changes.push({ field: 'priority', from: priorityLabel(before.priority), to: priorityLabel(data.priority) });
    }

    const beforeType = before.type || 'task';
    if (data.type !== undefined && data.type !== beforeType) {
      updates.type = data.type;
      changes.push({ field: 'type', from: typeLabel(beforeType), to: typeLabel(data.type) });
    }

    if (data.description !== undefined) {
      const next = data.description || null;
      const prev = before.description || null;
      if (next !== prev) {
        updates.description = next;
        changes.push({ field: 'description', from: clip(prev), to: clip(next) });
      }
    }

    if (data.dueDate !== undefined) {
      const next = data.dueDate ? parseDueDate(data.dueDate) : null;
      const nextDay = formatDueDate(next);
      const prevDay = formatDueDate(before.dueDate);
      if (nextDay !== prevDay) {
        updates.dueDate = next;
        updates.reminderSent = false;
        changes.push({ field: 'due_date', from: prevDay, to: nextDay });
      }
    }

    const parentPlan = await planParentChange(before, data, updates, changes);

    // A plain epic change — only for a regular task (a subtask's epic follows its parent, see planParentChange).
    let epicChanged = false;
    if (data.epicId !== undefined && !parentPlan.afterId) {
      const nextId = data.epicId || null;
      if (nextId !== refId(before.epicId)) {
        const nextEpic = nextId ? await this.epicOrThrow(before.groupId, nextId) : null;
        epicChanged = true;
        updates.epicId = nextEpic ? nextEpic._id : null;
        changes.push(epicChange(await resolveEpic(before.epicId), nextEpic));
      }
    }

    if (changes.length === 0) return { task: before, changes };

    let task: ITask | null = before;
    if (newStatus) {
      task = await taskService.updateTaskStatus(taskId, newStatus, actor._id as mongoose.Types.ObjectId);
    }
    if (task && Object.keys(updates).length > 0) {
      task = await taskService.updateTask(taskId, updates);
    }
    if (!task) throw new TaskMutationError('not_found', TASK_GONE_MESSAGE);

    await Promise.all(
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

    await afterTaskUpdated(before, task, actor, channel, parentPlan, {
      epicChanged,
      newEpicId: (updates.epicId as mongoose.Types.ObjectId | null | undefined) ?? null,
      newStatus,
    });

    // DMs — same behaviour as changes made in the bot
    const updatedTask = task;
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

    taskSyncService.syncTaskCard(updatedTask).catch(() => {});
    taskSyncService
      .postChangeSummary(updatedTask, actor._id as mongoose.Types.ObjectId, changes, ...viaArg(channel))
      .catch(() => {});

    return { task: updatedTask, changes };
  }

  /**
   * Deletes a task — its creator or a Telegram admin of the group only. Logs "deleted", removes the card and
   * tells the group. `group` is loaded when not given. A deleted parent's subtasks are kept as regular tasks
   * (`detached` lists them); a deleted subtask is logged on its parent.
   */
  async deleteTask(
    task: ITask,
    actor: IUser,
    options: { group?: IGroup | null; channel?: MutationChannel } = {},
  ): Promise<{ detached: ITask[] }> {
    const channel = options.channel ?? APP_CHANNEL;
    const isCreator = refId(task.createdBy) === String(actor._id);
    if (!isCreator) {
      const group = options.group ?? (await groupService.findGroupById(task.groupId));
      const isAdmin = group ? await isTelegramGroupAdmin(group.telegramGroupId, actor.telegramUserId) : false;
      if (!isAdmin) throw new TaskMutationError('forbidden', DELETE_FORBIDDEN_MESSAGE);
    }

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
}

export const taskMutationService = new TaskMutationService();
