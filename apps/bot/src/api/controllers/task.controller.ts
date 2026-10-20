import {
  getStatusCategory,
  isClosedStatus,
  statusesInCategory,
  TASK_STATUS_ORDER,
  TaskStatusCategory,
} from '@tbot/shared';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { sendError, validationMessage } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { TASK_NOT_FOUND_MESSAGE, GROUP_NOT_FOUND_MESSAGE } from 'src/api/middlewares/group-access.middleware';
import { overdueCutoff, resolveGroupTimezone } from 'src/api/timezone';
import { createTaskSchema, TaskDueFilter, taskQuerySchema, updateTaskSchema } from 'src/api/validation';
import { IGroup } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { groupService } from 'src/database/services/group.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { TASK_POPULATE_FULL } from 'src/database/services/task-populate';
import { taskService, TaskFilters } from 'src/database/services/task.service';
import {
  ASSIGNEE_NOT_MEMBER_MESSAGE,
  DELETE_FORBIDDEN_MESSAGE,
  EPIC_NOT_IN_GROUP_MESSAGE,
  refId,
  TaskMutationError,
  TaskMutationErrorCode,
  taskMutationService,
} from 'src/shared/services/task-mutation.service';

export { ASSIGNEE_NOT_MEMBER_MESSAGE, DELETE_FORBIDDEN_MESSAGE, EPIC_NOT_IN_GROUP_MESSAGE, refId };
const SIGN_IN_MESSAGE = 'Please sign in to continue.';

const MUTATION_ERROR_STATUS: Record<TaskMutationErrorCode, number> = {
  assignee_not_member: 400,
  epic_not_in_group: 400,
  forbidden: 403,
  not_found: 404,
};

/** Sends the HTTP error for a TaskMutationError (true), or leaves other errors to the caller (false). */
function sendMutationError(res: Response, error: unknown): boolean {
  if (!(error instanceof TaskMutationError)) return false;
  const status = MUTATION_ERROR_STATUS[error.code];
  sendError(res, status, error.code === 'not_found' ? TASK_NOT_FOUND_MESSAGE : error.message, status === 400 ? 'Validation error' : undefined);
  return true;
}

/** Populate user + epic refs for API responses (no-op for plain objects). */
async function populateTask<T>(task: T): Promise<T> {
  const doc = task as unknown as { populate?: (paths: unknown) => Promise<unknown> };
  if (doc && typeof doc.populate === 'function') {
    await doc.populate(TASK_POPULATE_FULL);
  }
  return task;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Translate `due` into a dueDate range. Due dates are stored at 00:00Z of their calendar day,
 * and "today" is the group's local date (as 00:00Z), so day comparisons are plain Date ranges.
 * `overdue` also implies "not closed" — see resolveStatusFilter's `open`.
 */
export function resolveDueFilter(
  due: TaskDueFilter | undefined,
  timeZone: string,
  now: Date = new Date(),
): Pick<TaskFilters, 'dueFrom' | 'dueTo' | 'dueNone'> {
  if (!due) return {};
  if (due === 'none') return { dueNone: true };
  const today = overdueCutoff(timeZone, now);
  if (due === 'overdue') return { dueTo: today };
  if (due === 'today') return { dueFrom: today, dueTo: new Date(today.getTime() + DAY_MS) };
  return { dueFrom: today, dueTo: new Date(today.getTime() + 7 * DAY_MS) };
}

export class TaskController {
  /**
   * Parse GET /groups/:groupId/tasks query params into service filters. Sends a 400/401 and
   * returns null when they're invalid.
   */
  private async parseListFilters(req: Request, res: Response): Promise<TaskFilters | null> {
    const authReq = req as AuthenticatedRequest;
    const groupId = req.params.groupId as string;

    const queryResult = taskQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      sendError(res, 400, validationMessage(queryResult.error), 'Invalid query params');
      return null;
    }

    const { assigneeId, epicId, status, category, open, due, ...rest } = queryResult.data;
    const filters: TaskFilters = { ...rest };
    if (epicId === 'none') {
      filters.epicId = null;
    } else if (epicId) {
      filters.epicId = new mongoose.Types.ObjectId(epicId);
    }
    // Overdue only counts tasks that are still open (done/cancelled are never overdue).
    const statuses = resolveStatusFilter({ status, category, open: open || due === 'overdue' });
    if (statuses) {
      filters.statuses = statuses;
    }
    if (due) {
      const group =
        due === 'none' ? null : (authReq.group ?? (await groupService.findGroupById(new mongoose.Types.ObjectId(groupId))));
      Object.assign(filters, resolveDueFilter(due, resolveGroupTimezone(group?.timezone)));
    }
    if (assigneeId === 'me') {
      if (!authReq.user) {
        sendError(res, 401, SIGN_IN_MESSAGE);
        return null;
      }
      filters.assigneeId = authReq.user._id as mongoose.Types.ObjectId;
    } else if (assigneeId === 'none') {
      filters.assigneeId = null;
    } else if (assigneeId) {
      filters.assigneeId = new mongoose.Types.ObjectId(assigneeId);
    }
    return filters;
  }

  /**
   * GET /api/groups/:groupId/tasks — one page (`page`, `limit` ≤ 100, default 20), newest first
   * unless `sort`/`dir` are set. Every filter combines with `status`, so a board column is this
   * endpoint with `status=<column>`.
   */
  async listTasks(req: Request, res: Response) {
    const filters = await this.parseListFilters(req, res);
    if (!filters) return;

    const { tasks, total, hasMore } = await taskService.getTasksByGroup(
      new mongoose.Types.ObjectId(req.params.groupId as string),
      filters,
    );

    res.json({
      data: tasks,
      meta: { page: filters.page, limit: filters.limit, total, hasMore },
    });
  }

  /**
   * GET /api/groups/:groupId/tasks/counts — how many tasks match the same filters as the list,
   * per status (board column headers, hidden-column hint) and in total. page/limit/sort are ignored.
   */
  async countTasks(req: Request, res: Response) {
    const filters = await this.parseListFilters(req, res);
    if (!filters) return;

    const { byStatus, total } = await taskService.countTasksByStatus(
      new mongoose.Types.ObjectId(req.params.groupId as string),
      filters,
    );
    res.json({ data: { byStatus, total } });
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

    const objectGroupId = new mongoose.Types.ObjectId(groupId);
    const group: IGroup | null = authReq.group ?? (await groupService.findGroupById(objectGroupId));
    if (!group) {
      sendError(res, 404, GROUP_NOT_FOUND_MESSAGE);
      return;
    }

    try {
      const { task } = await taskMutationService.createTask(group, user, bodyResult.data);
      res.status(201).json({ data: await populateTask(task) });
    } catch (error) {
      if (!sendMutationError(res, error)) throw error;
    }
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

    const before = authReq.task ?? (await taskService.getTaskById(taskId));
    if (!before) {
      sendError(res, 404, TASK_NOT_FOUND_MESSAGE);
      return;
    }

    try {
      const { task } = await taskMutationService.updateTask(before, user, bodyResult.data);
      res.json({ data: await populateTask(task) });
    } catch (error) {
      if (!sendMutationError(res, error)) throw error;
    }
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

    try {
      await taskMutationService.deleteTask(task, user, { group: authReq.group });
      res.json({ data: { deleted: true } });
    } catch (error) {
      if (!sendMutationError(res, error)) throw error;
    }
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
