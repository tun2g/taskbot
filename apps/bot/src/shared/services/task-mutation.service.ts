import {
  EPIC_COLOR_EMOJI,
  EpicColor,
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
import { Epic, IEpic } from 'src/database/models/epic.model';
import { IGroup } from 'src/database/models/group.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { ITask } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import { epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
import { TaskChange, taskSyncService, userDisplayName } from 'src/shared/services/task-sync.service';

// The one place where a task is created / changed / deleted on behalf of a person from outside the chat
// (the REST API for the Mini App, the MCP server). Every caller gets the same validation, activity log,
// DMs to assignees and group card / change line.

export const ASSIGNEE_NOT_MEMBER_MESSAGE =
  'That person is not a member of this group. Pick someone from the member list.';
export const EPIC_NOT_IN_GROUP_MESSAGE = 'That epic is not part of this group. Pick an epic from the list.';
export const DELETE_FORBIDDEN_MESSAGE = 'Only the task creator or a group admin can delete this task.';
export const TASK_GONE_MESSAGE = 'This task could not be found. It may have been deleted.';
const ACTIVITY_TEXT_MAX = 300;

export type TaskMutationErrorCode = 'assignee_not_member' | 'epic_not_in_group' | 'forbidden' | 'not_found';

/** A rule the change broke; `message` is a plain sentence safe to show to people (and LLMs). */
export class TaskMutationError extends Error {
  constructor(
    public readonly code: TaskMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TaskMutationError';
  }
}

/** Which channel made the change: `activity` is stored in the log, `label` shows as "(via …)" in the group. */
export interface MutationChannel {
  activity: TaskActivityVia;
  /** Omitted = "app" (the default wording of every group line). */
  label?: string;
}

export const APP_CHANNEL: MutationChannel = { activity: 'app' };

export interface CreateTaskFields {
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  /** User id of a group member. */
  assigneeId?: string;
  /** YYYY-MM-DD (legacy ISO datetimes are cut to their day). */
  dueDate?: string;
  /** Epic id in this group. */
  epicId?: string;
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
  /** Epic id, or null / '' to take the task out of its epic. */
  epicId?: string | null;
}

type EpicLike = Pick<IEpic, 'title' | 'color'> & { _id: unknown };

/** Id of a ref that may be populated (user doc) or a bare ObjectId/string. */
export function refId(ref: unknown): string | null {
  if (!ref) return null;
  if (typeof ref === 'object' && ref !== null && '_id' in ref) return String((ref as { _id: unknown })._id);
  return String(ref);
}

function isUserDoc(value: unknown): value is IUser {
  return !!value && typeof value === 'object' && 'telegramUserId' in (value as object);
}

function isEpicDoc(value: unknown): value is EpicLike {
  return !!value && typeof value === 'object' && 'title' in (value as object) && 'color' in (value as object);
}

async function resolveUser(ref: unknown): Promise<IUser | null> {
  if (!ref) return null;
  if (isUserDoc(ref)) return ref;
  return User.findById(refId(ref));
}

/** A task's epic as a doc with title/color (populated ref, or loaded by id), or null. */
async function resolveEpic(ref: unknown): Promise<EpicLike | null> {
  if (!ref) return null;
  if (isEpicDoc(ref)) return ref;
  return Epic.findById(refId(ref));
}

const epicIcon = (epic: EpicLike | null) => (epic ? (EPIC_COLOR_EMOJI[epic.color as EpicColor] ?? null) : null);
const statusLabel = (s: string) => TASK_STATUS_LABELS[s as TaskStatus] ?? s;
const priorityLabel = (p: string) => TASK_PRIORITY_LABELS[p as TaskPriority] ?? p;
const typeLabel = (t: string) => TASK_TYPE_LABELS[t as TaskType] ?? t;

function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > ACTIVITY_TEXT_MAX ? `${text.slice(0, ACTIVITY_TEXT_MAX - 1)}…` : text;
}

/** Extra "(via …)" argument for the group-line helpers — only when it isn't the default "app". */
const viaArg = (channel: MutationChannel): [] | [string] => (channel.label ? [channel.label] : []);

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
    const epic = data.epicId ? await this.epicOrThrow(groupId, data.epicId) : null;

    const task = await taskService.createTask({
      groupId,
      createdBy: actor._id as mongoose.Types.ObjectId,
      title: data.title,
      description: data.description,
      type: data.type,
      priority: data.priority,
      assigneeId: data.assigneeId ? new mongoose.Types.ObjectId(data.assigneeId) : undefined,
      dueDate: data.dueDate ? (parseDueDate(data.dueDate) ?? undefined) : undefined,
      epicId: epic ? (epic._id as mongoose.Types.ObjectId) : undefined,
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

    if (assignee) {
      notificationService.notifyAssignment(task, assignee, actor).catch(() => {});
    }
    if ((options.announce ?? 'card') === 'card') {
      taskSyncService.syncTaskCard(task, { created: true }).catch(() => {});
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

    if (data.epicId !== undefined) {
      const nextId = data.epicId || null;
      if (nextId !== refId(before.epicId)) {
        const nextEpic = nextId ? await this.epicOrThrow(before.groupId, nextId) : null;
        const prevEpic = await resolveEpic(before.epicId);
        updates.epicId = nextEpic ? nextEpic._id : null;
        changes.push({
          field: 'epic',
          from: prevEpic ? clip(prevEpic.title) : null,
          to: nextEpic ? clip(nextEpic.title) : null,
          fromIcon: epicIcon(prevEpic),
          toIcon: epicIcon(nextEpic),
        });
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
   * tells the group. `group` is loaded when not given.
   */
  async deleteTask(
    task: ITask,
    actor: IUser,
    options: { group?: IGroup | null; channel?: MutationChannel } = {},
  ): Promise<void> {
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
  }
}

export const taskMutationService = new TaskMutationService();
