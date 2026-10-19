import {
  getStatusCategory,
  isClosedStatus,
  statusesInCategory,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TASK_TYPE_LABELS,
  TaskPriority,
  TaskStatus,
  TaskStatusCategory,
  TaskType,
} from '@tbot/shared';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { sendError, validationMessage } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { TASK_NOT_FOUND_MESSAGE, GROUP_NOT_FOUND_MESSAGE } from 'src/api/middlewares/group-access.middleware';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { overdueCutoff, resolveGroupTimezone } from 'src/api/timezone';
import {
  createTaskSchema,
  formatDueDate,
  parseDueDate,
  taskQuerySchema,
  updateTaskSchema,
} from 'src/api/validation';
import { IGroup } from 'src/database/models/group.model';
import { ITask, Task } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService, TaskFilters } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
import { TaskChange, taskSyncService, userDisplayName } from 'src/shared/services/task-sync.service';

export const DELETE_FORBIDDEN_MESSAGE = 'Only the task creator or a group admin can delete this task.';
export const ASSIGNEE_NOT_MEMBER_MESSAGE =
  'That person is not a member of this group. Pick someone from the member list.';
const SIGN_IN_MESSAGE = 'Please sign in to continue.';
const ACTIVITY_TEXT_MAX = 300;

const POPULATE_PATHS = 'createdBy assigneeId completedBy';

type UserLike = IUser;

/** Populate user refs for API responses (no-op for plain objects). */
async function populateTask<T>(task: T): Promise<T> {
  const doc = task as unknown as { populate?: (paths: string) => Promise<unknown> };
  if (doc && typeof doc.populate === 'function') {
    await doc.populate(POPULATE_PATHS);
  }
  return task;
}

/** Id of a ref that may be populated (user doc) or a bare ObjectId/string. */
export function refId(ref: unknown): string | null {
  if (!ref) return null;
  if (typeof ref === 'object' && ref !== null && '_id' in ref) return String((ref as { _id: unknown })._id);
  return String(ref);
}

function isUserDoc(value: unknown): value is UserLike {
  return !!value && typeof value === 'object' && 'telegramUserId' in (value as object);
}

async function resolveUser(ref: unknown): Promise<UserLike | null> {
  if (!ref) return null;
  if (isUserDoc(ref)) return ref;
  return User.findById(refId(ref));
}

const statusLabel = (s: string) => TASK_STATUS_LABELS[s as TaskStatus] ?? s;
const priorityLabel = (p: string) => TASK_PRIORITY_LABELS[p as TaskPriority] ?? p;
const typeLabel = (t: string) => TASK_TYPE_LABELS[t as TaskType] ?? t;

function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > ACTIVITY_TEXT_MAX ? `${text.slice(0, ACTIVITY_TEXT_MAX - 1)}…` : text;
}

/**
 * Combine `status`, `category` and `open` into the set of statuses to match.
 * Returns undefined when no status filter applies.
 */
export function resolveStatusFilter(query: {
  status?: string;
  category?: string;
  open?: boolean;
}): string[] | undefined {
  if (!query.status && !query.category && !query.open) return undefined;
  let statuses: string[] = query.category
    ? statusesInCategory(query.category as TaskStatusCategory)
    : [...TASK_STATUS_ORDER];
  if (query.open) statuses = statuses.filter((s) => !isClosedStatus(s));
  if (query.status) statuses = statuses.filter((s) => s === query.status);
  return statuses;
}

function notifyUnassigned(task: ITask, previous: UserLike, changedBy: UserLike) {
  // Provided by the notification service when available.
  const svc = notificationService as typeof notificationService & {
    notifyUnassigned?: (task: ITask, previous: UserLike, changedBy: UserLike) => Promise<void>;
  };
  if (typeof svc.notifyUnassigned === 'function') {
    svc.notifyUnassigned(task, previous, changedBy).catch(() => {});
  }
}

export class TaskController {
  /** GET /api/groups/:groupId/tasks */
  async listTasks(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const groupId = req.params.groupId as string;

    const queryResult = taskQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      sendError(res, 400, validationMessage(queryResult.error), 'Invalid query params');
      return;
    }

    const { assigneeId, status, category, open, ...rest } = queryResult.data;
    const filters: TaskFilters = { ...rest };
    const statuses = resolveStatusFilter({ status, category, open });
    if (statuses) {
      filters.statuses = statuses;
    }
    if (assigneeId === 'me') {
      if (!authReq.user) {
        sendError(res, 401, SIGN_IN_MESSAGE);
        return;
      }
      filters.assigneeId = authReq.user._id as mongoose.Types.ObjectId;
    } else if (assigneeId === 'none') {
      filters.assigneeId = null;
    } else if (assigneeId) {
      filters.assigneeId = new mongoose.Types.ObjectId(assigneeId);
    }

    const { tasks, total } = await taskService.getTasksByGroup(new mongoose.Types.ObjectId(groupId), filters);

    res.json({
      data: tasks,
      meta: { page: rest.page, limit: rest.limit, total },
    });
  }

  /** POST /api/groups/:groupId/tasks */
  async createTask(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const groupId = req.params.groupId as string;

    const user = authReq.user;
    if (!user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }

    const bodyResult = createTaskSchema.safeParse(req.body);
    if (!bodyResult.success) {
      sendError(res, 400, validationMessage(bodyResult.error), 'Validation error');
      return;
    }
    const data = bodyResult.data;

    const objectGroupId = new mongoose.Types.ObjectId(groupId);
    const group: IGroup | null = authReq.group ?? (await groupService.findGroupById(objectGroupId));
    if (!group) {
      sendError(res, 404, GROUP_NOT_FOUND_MESSAGE);
      return;
    }

    let assignee: UserLike | null = null;
    if (data.assigneeId) {
      const isMember = await groupMemberService.isMember(objectGroupId, data.assigneeId);
      assignee = isMember ? await User.findById(data.assigneeId) : null;
      if (!assignee) {
        sendError(res, 400, ASSIGNEE_NOT_MEMBER_MESSAGE, 'Validation error');
        return;
      }
    }

    const task = await taskService.createTask({
      groupId: objectGroupId,
      createdBy: user._id as mongoose.Types.ObjectId,
      title: data.title,
      description: data.description,
      type: data.type,
      priority: data.priority,
      assigneeId: data.assigneeId ? new mongoose.Types.ObjectId(data.assigneeId) : undefined,
      dueDate: data.dueDate ? (parseDueDate(data.dueDate) ?? undefined) : undefined,
      // So the card is posted to the group
      taskCardChatId: group.telegramGroupId,
    });

    await taskActivityService.record({
      taskId: task._id as mongoose.Types.ObjectId,
      groupId: objectGroupId,
      actor: user._id as mongoose.Types.ObjectId,
      action: 'created',
      to: clip(task.title),
      via: 'app',
    });

    if (assignee) {
      notificationService.notifyAssignment(task, assignee, user).catch(() => {});
    }
    taskSyncService.syncTaskCard(task, { created: true }).catch(() => {});

    res.status(201).json({ data: await populateTask(task) });
  }

  /** GET /api/tasks/:taskId (requireTaskMember sets req.task) */
  async getTask(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const task = authReq.task ?? (await taskService.getTaskById(req.params.taskId as string));
    if (!task) {
      sendError(res, 404, TASK_NOT_FOUND_MESSAGE);
      return;
    }

    res.json({ data: await populateTask(task) });
  }

  /** GET /api/tasks/:taskId/activity */
  async getActivity(req: Request, res: Response) {
    const taskId = req.params.taskId as string;
    const activity = await taskActivityService.getForTask(taskId);
    res.json({ data: activity });
  }

  /** PATCH /api/tasks/:taskId */
  async updateTask(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const taskId = req.params.taskId as string;

    const user = authReq.user;
    if (!user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }

    const bodyResult = updateTaskSchema.safeParse(req.body);
    if (!bodyResult.success) {
      sendError(res, 400, validationMessage(bodyResult.error), 'Validation error');
      return;
    }
    const data = bodyResult.data;

    const before = authReq.task ?? (await taskService.getTaskById(taskId));
    if (!before) {
      sendError(res, 404, TASK_NOT_FOUND_MESSAGE);
      return;
    }

    // Work out what actually changed — only those fields are written, logged and announced.
    const changes: TaskChange[] = [];
    const updates: Record<string, unknown> = {};
    let newStatus: string | undefined;

    if (data.status !== undefined && data.status !== before.status) {
      newStatus = data.status;
      changes.push({ field: 'status', from: statusLabel(before.status), to: statusLabel(data.status) });
    }

    const previousAssignee = await resolveUser(before.assigneeId);
    let newAssignee: UserLike | null = null;
    let assigneeChanged = false;
    if (data.assigneeId !== undefined) {
      const nextId = data.assigneeId || null;
      if (nextId !== refId(before.assigneeId)) {
        if (nextId) {
          const isMember = await groupMemberService.isMember(before.groupId, nextId);
          newAssignee = isMember ? await User.findById(nextId) : null;
          if (!newAssignee) {
            sendError(res, 400, ASSIGNEE_NOT_MEMBER_MESSAGE, 'Validation error');
            return;
          }
        }
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

    if (changes.length === 0) {
      res.json({ data: await populateTask(before) });
      return;
    }

    let task: ITask | null = before;
    if (newStatus) {
      task = await taskService.updateTaskStatus(taskId, newStatus, user._id as mongoose.Types.ObjectId);
    }
    if (task && Object.keys(updates).length > 0) {
      task = await taskService.updateTask(taskId, updates);
    }
    if (!task) {
      sendError(res, 404, TASK_NOT_FOUND_MESSAGE);
      return;
    }

    await Promise.all(
      changes.map((change) =>
        taskActivityService.record({
          taskId: before._id as mongoose.Types.ObjectId,
          groupId: before.groupId,
          actor: user._id as mongoose.Types.ObjectId,
          action: change.field,
          from: change.from,
          to: change.to,
          via: 'app',
        }),
      ),
    );

    // DMs — same behaviour as changes made in the bot
    const updatedTask = task;
    if (assigneeChanged) {
      if (newAssignee) notificationService.notifyAssignment(updatedTask, newAssignee, user).catch(() => {});
      if (previousAssignee) notifyUnassigned(updatedTask, previousAssignee, user);
    }
    if (newStatus) {
      const currentAssignee = assigneeChanged ? newAssignee : previousAssignee;
      if (currentAssignee && String(currentAssignee._id) !== String(user._id)) {
        notificationService.notifyStatusChange(updatedTask, user, currentAssignee).catch(() => {});
      }
    }

    taskSyncService.syncTaskCard(updatedTask).catch(() => {});
    taskSyncService.postChangeSummary(updatedTask, user._id as mongoose.Types.ObjectId, changes).catch(() => {});

    res.json({ data: await populateTask(updatedTask) });
  }

  /** DELETE /api/tasks/:taskId — creator or Telegram group admin only. */
  async deleteTask(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const taskId = req.params.taskId as string;

    const user = authReq.user;
    if (!user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }

    const task = authReq.task ?? (await taskService.getTaskById(taskId));
    if (!task) {
      sendError(res, 404, TASK_NOT_FOUND_MESSAGE);
      return;
    }

    const isCreator = refId(task.createdBy) === String(user._id);
    if (!isCreator) {
      const group = authReq.group ?? (await groupService.findGroupById(task.groupId));
      const isAdmin = group ? await isTelegramGroupAdmin(group.telegramGroupId, user.telegramUserId) : false;
      if (!isAdmin) {
        sendError(res, 403, DELETE_FORBIDDEN_MESSAGE);
        return;
      }
    }

    const deleted = await taskService.deleteTask(taskId);
    if (!deleted) {
      sendError(res, 404, TASK_NOT_FOUND_MESSAGE);
      return;
    }

    await taskActivityService.record({
      taskId: task._id as mongoose.Types.ObjectId,
      groupId: task.groupId,
      actor: user._id as mongoose.Types.ObjectId,
      action: 'deleted',
      from: clip(`#${task.taskNumber} ${task.title}`),
      via: 'app',
    });
    taskSyncService.onTaskDeleted(task, user._id as mongoose.Types.ObjectId).catch(() => {});

    res.json({ data: { deleted: true } });
  }

  /** GET /api/groups/:groupId/stats → per-status counts + overdue + byCategory */
  async getStats(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const objectGroupId = new mongoose.Types.ObjectId(req.params.groupId as string);
    const group = authReq.group ?? (await groupService.findGroupById(objectGroupId));
    const cutoff = overdueCutoff(resolveGroupTimezone(group?.timezone));

    const [stats, overdue] = await Promise.all([
      taskService.getTaskStats(objectGroupId),
      Task.countDocuments({
        groupId: objectGroupId,
        status: { $nin: statusesInCategory(TaskStatusCategory.DONE) },
        dueDate: { $ne: null, $lt: cutoff },
      }),
    ]);

    const perStatus: Record<string, number> = {};
    const byCategory: Record<TaskStatusCategory, number> = { todo: 0, in_progress: 0, done: 0 };
    for (const s of TASK_STATUS_ORDER) {
      const count = stats[s] ?? 0;
      perStatus[s] = count;
      byCategory[getStatusCategory(s)] += count;
    }

    res.json({ data: { ...perStatus, overdue: overdue ?? 0, byCategory } });
  }
}

export const taskController = new TaskController();
