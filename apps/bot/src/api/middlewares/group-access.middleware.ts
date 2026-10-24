import { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { sendError } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { epicService } from 'src/database/services/epic.service';
import { taskService } from 'src/database/services/task.service';
import { memberSyncService } from 'src/shared/services/member-sync.service';
import { groupUnavailableMessage, isGroupActive } from 'src/shared/utils/group-status';

export const NOT_A_MEMBER_MESSAGE = 'You are not a member of this group.';
export const GROUP_NOT_FOUND_MESSAGE = 'This group could not be found. It may have been removed.';
export const TASK_NOT_FOUND_MESSAGE = 'This task could not be found. It may have been deleted.';
export const EPIC_NOT_FOUND_MESSAGE = 'This epic could not be found. It may have been deleted.';
/** `error` of a 403 for a member whose group has no service (pending, paused, ...): the app shows a group-level screen. */
export const GROUP_UNAVAILABLE_ERROR = 'Group Unavailable';

export type GroupAccess =
  | { ok: true; group: IGroup }
  /** `inactive`: the caller is a member, but the group has no service (pending approval, suspended, ...). */
  | { ok: false; status: 403 | 404; message: string; inactive?: IGroup };

/**
 * Loads the group and checks that the user is a member — asking Telegram before refusing someone who was
 * never seen in the group (they may just not have posted yet) — and that the group gets service (ACTIVE).
 * `allowInactive` skips the last check (the MCP server reports it per tool instead). Shared by the REST API and MCP.
 */
export async function checkGroupAccess(
  groupId: string,
  user: Pick<IUser, '_id' | 'telegramUserId'>,
  options: { allowInactive?: boolean } = {},
): Promise<GroupAccess> {
  if (!mongoose.Types.ObjectId.isValid(groupId)) return { ok: false, status: 404, message: GROUP_NOT_FOUND_MESSAGE };

  const group = await groupService.findGroupById(new mongoose.Types.ObjectId(groupId));
  if (!group) return { ok: false, status: 404, message: GROUP_NOT_FOUND_MESSAGE };

  const isMember =
    (await groupMemberService.isMember(group._id as mongoose.Types.ObjectId, user._id as mongoose.Types.ObjectId)) ||
    (await memberSyncService.verifyAndAddMember(group, user as IUser));
  if (!isMember) return { ok: false, status: 403, message: NOT_A_MEMBER_MESSAGE };
  // Membership first: non-members learn nothing about a group's status.
  if (!options.allowInactive && !isGroupActive(group)) {
    return { ok: false, status: 403, message: groupUnavailableMessage(group), inactive: group };
  }
  return { ok: true, group };
}

/** Member check for a task's / epic's group, then the same service check as `checkGroupAccess`. */
async function checkParentGroupAccess(groupId: mongoose.Types.ObjectId, user: IUser): Promise<GroupAccess> {
  const group = await groupService.findGroupById(groupId);
  if (!group) return { ok: false, status: 403, message: NOT_A_MEMBER_MESSAGE };
  const isMember = (await groupMemberService.isMember(groupId, user._id)) || (await memberSyncService.verifyAndAddMember(group, user));
  if (!isMember) return { ok: false, status: 403, message: NOT_A_MEMBER_MESSAGE };
  if (!isGroupActive(group)) return { ok: false, status: 403, message: groupUnavailableMessage(group), inactive: group };
  return { ok: true, group };
}

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

    const access = await checkGroupAccess(req.params[paramName] as string, user);
    if (!access.ok) {
      sendError(res, access.status, access.message, access.inactive ? GROUP_UNAVAILABLE_ERROR : undefined);
      return;
    }

    authReq.group = access.group;
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

    const access = await checkParentGroupAccess(task.groupId, user);
    if (!access.ok) {
      sendError(res, access.status, access.message, access.inactive ? GROUP_UNAVAILABLE_ERROR : undefined);
      return;
    }

    authReq.task = task;
    next();
  };
}

/**
 * Epic-scoped routes: loads the epic (404), then requires the caller to be a member of the
 * epic's group (403). Any member may edit or delete an epic. Sets `req.epic`.
 */
export function requireEpicMember(paramName = 'epicId') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      sendError(res, 401, 'Please sign in to continue.');
      return;
    }

    const epicId = req.params[paramName] as string;
    const epic = mongoose.Types.ObjectId.isValid(epicId) ? await epicService.findById(epicId) : null;
    if (!epic) {
      sendError(res, 404, EPIC_NOT_FOUND_MESSAGE);
      return;
    }

    const access = await checkParentGroupAccess(epic.groupId, user);
    if (!access.ok) {
      sendError(res, access.status, access.message, access.inactive ? GROUP_UNAVAILABLE_ERROR : undefined);
      return;
    }

    authReq.epic = epic;
    next();
  };
}
