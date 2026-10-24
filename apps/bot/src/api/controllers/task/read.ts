import { getStatusCategory, statusesInCategory, TASK_STATUS_ORDER, TaskStatusCategory } from '@tbot/shared';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { parseListFilters } from 'src/api/controllers/task/filters';
import { taskJson, withSubtaskProgress } from 'src/api/controllers/task/respond';
import { sendError } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { TASK_NOT_FOUND_MESSAGE } from 'src/api/middlewares/group-access.middleware';
import { overdueCutoff, resolveGroupTimezone } from 'src/api/timezone';
import { Task } from 'src/database/models/task.model';
import { groupService } from 'src/database/services/group.service';
import { subtaskService } from 'src/database/services/subtask.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';

/**
 * GET /api/groups/:groupId/tasks — one page (`page`, `limit` ≤ 100, default 20), newest first
 * unless `sort`/`dir` are set. Every filter combines with `status`, so a board column is this
 * endpoint with `status=<column>`.
 */
export async function listTasks(req: Request, res: Response) {
  const filters = await parseListFilters(req, res);
  if (!filters) return;

  const { tasks, total, hasMore } = await taskService.getTasksByGroup(
    new mongoose.Types.ObjectId(req.params.groupId as string),
    filters,
  );

  res.json({
    data: await withSubtaskProgress(tasks),
    meta: { page: filters.page, limit: filters.limit, total, hasMore },
  });
}

/**
 * GET /api/groups/:groupId/tasks/counts — how many tasks match the same filters as the list,
 * per status (board column headers, hidden-column hint), per assignee (assignee board) and in total.
 * page/limit/sort are ignored.
 */
export async function countTasks(req: Request, res: Response) {
  const filters = await parseListFilters(req, res);
  if (!filters) return;

  const counts = await taskService.countTasksByStatus(new mongoose.Types.ObjectId(req.params.groupId as string), filters);
  res.json({ data: counts });
}

/** GET /api/tasks/:taskId (requireTaskMember sets req.task) */
export async function getTask(req: Request, res: Response) {
  const authReq = req as AuthenticatedRequest;
  const task = authReq.task ?? (await taskService.getTaskById(req.params.taskId as string));
  if (!task) {
    sendError(res, 404, TASK_NOT_FOUND_MESSAGE);
    return;
  }

  res.json({ data: await taskJson(task) });
}

/** GET /api/tasks/:taskId/subtasks — the task's subtasks, oldest first (empty for a subtask). */
export async function getSubtasks(req: Request, res: Response) {
  const subtasks = await subtaskService.list(req.params.taskId as string);
  res.json({ data: subtasks });
}

/** GET /api/tasks/:taskId/activity */
export async function getActivity(req: Request, res: Response) {
  const taskId = req.params.taskId as string;
  const activity = await taskActivityService.getForTask(taskId);
  res.json({ data: activity });
}

/** GET /api/groups/:groupId/stats → per-status counts + overdue + byCategory */
export async function getStats(req: Request, res: Response) {
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
