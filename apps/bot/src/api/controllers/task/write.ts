import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { SIGN_IN_MESSAGE, sendMutationError, taskJson } from 'src/api/controllers/task/respond';
import { sendError, validationMessage } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { GROUP_NOT_FOUND_MESSAGE, TASK_NOT_FOUND_MESSAGE } from 'src/api/middlewares/group-access.middleware';
import { createTaskSchema, updateTaskSchema } from 'src/api/validation';
import { IGroup } from 'src/database/models/group.model';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { taskMutationService } from 'src/shared/services/task-mutation.service';

/** POST /api/groups/:groupId/tasks */
export async function createTask(req: Request, res: Response) {
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
    res.status(201).json({ data: await taskJson(task) });
  } catch (error) {
    if (!sendMutationError(res, error)) throw error;
  }
}

/** PATCH /api/tasks/:taskId */
export async function updateTask(req: Request, res: Response) {
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
    res.json({ data: await taskJson(task) });
  } catch (error) {
    if (!sendMutationError(res, error)) throw error;
  }
}

/** DELETE /api/tasks/:taskId — creator or Telegram group admin only. */
export async function deleteTask(req: Request, res: Response) {
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
    const { detached } = await taskMutationService.deleteTask(task, user, { group: authReq.group });
    // Subtasks of a deleted parent are kept as regular tasks.
    res.json({ data: { deleted: true, detachedSubtasks: detached.length } });
  } catch (error) {
    if (!sendMutationError(res, error)) throw error;
  }
}
