import { Request, Response } from 'express';
import { countTasks, getActivity, getStats, getSubtasks, getTask, listTasks } from 'src/api/controllers/task/read';
import { createTask, deleteTask, updateTask } from 'src/api/controllers/task/write';
import {
  ASSIGNEE_NOT_MEMBER_MESSAGE,
  DELETE_FORBIDDEN_MESSAGE,
  EPIC_NOT_IN_GROUP_MESSAGE,
  refId,
} from 'src/shared/services/task-mutation.service';

export { ASSIGNEE_NOT_MEMBER_MESSAGE, DELETE_FORBIDDEN_MESSAGE, EPIC_NOT_IN_GROUP_MESSAGE, refId };
export { resolveDueFilter, resolveStatusFilter } from 'src/api/controllers/task/filters';

/** Task REST handlers (see ./task/ for the reads, writes, list filters and response shaping). */
export class TaskController {
  listTasks(req: Request, res: Response) {
    return listTasks(req, res);
  }

  countTasks(req: Request, res: Response) {
    return countTasks(req, res);
  }

  createTask(req: Request, res: Response) {
    return createTask(req, res);
  }

  getTask(req: Request, res: Response) {
    return getTask(req, res);
  }

  getSubtasks(req: Request, res: Response) {
    return getSubtasks(req, res);
  }

  getActivity(req: Request, res: Response) {
    return getActivity(req, res);
  }

  updateTask(req: Request, res: Response) {
    return updateTask(req, res);
  }

  deleteTask(req: Request, res: Response) {
    return deleteTask(req, res);
  }

  getStats(req: Request, res: Response) {
    return getStats(req, res);
  }
}

export const taskController = new TaskController();
