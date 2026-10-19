import { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { sendError } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { memberSyncService } from 'src/shared/services/member-sync.service';

export const NOT_A_MEMBER_MESSAGE = 'You are not a member of this group.';
export const GROUP_NOT_FOUND_MESSAGE = 'This group could not be found. It may have been removed.';
export const TASK_NOT_FOUND_MESSAGE = 'This task could not be found. It may have been deleted.';

/**
 * Group-scoped routes: loads the group (404) and requires the caller to be a member (403).
 * Sets `req.group`.
 */
export function requireGroupMember(paramName = 'groupId') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      sendError(res, 401, 'Please sign in to continue.');
      return;
    }

    const groupId = req.params[paramName] as string;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      sendError(res, 404, GROUP_NOT_FOUND_MESSAGE);
      return;
    }

    const group = await groupService.findGroupById(new mongoose.Types.ObjectId(groupId));
    if (!group) {
      sendError(res, 404, GROUP_NOT_FOUND_MESSAGE);
      return;
    }

    // Not seen in the group yet (never spoke there)? Ask Telegram before refusing.
    const isMember =
      (await groupMemberService.isMember(group._id as mongoose.Types.ObjectId, user._id)) ||
      (await memberSyncService.verifyAndAddMember(group, user));
    if (!isMember) {
      sendError(res, 403, NOT_A_MEMBER_MESSAGE);
      return;
    }

    authReq.group = group;
    next();
  };
}

/**
 * Task-scoped routes: loads the task (404), then requires the caller to be a member of the
 * task's group (403). Sets `req.task` (createdBy/assigneeId populated).
 */
export function requireTaskMember(paramName = 'taskId') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      sendError(res, 401, 'Please sign in to continue.');
      return;
    }

    const taskId = req.params[paramName] as string;
    const task = mongoose.Types.ObjectId.isValid(taskId) ? await taskService.getTaskById(taskId) : null;
    if (!task) {
      sendError(res, 404, TASK_NOT_FOUND_MESSAGE);
      return;
    }

    if (!(await groupMemberService.isMember(task.groupId, user._id))) {
      const group = await groupService.findGroupById(task.groupId);
      if (!group || !(await memberSyncService.verifyAndAddMember(group, user))) {
        sendError(res, 403, NOT_A_MEMBER_MESSAGE);
        return;
      }
    }

    authReq.task = task;
    next();
  };
}
