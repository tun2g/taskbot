import mongoose from 'mongoose';
import { IEpic } from 'src/database/models/epic.model';
import { IUser, User } from 'src/database/models/user.model';
import { epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import {
  ASSIGNEE_NOT_MEMBER_MESSAGE,
  EPIC_NOT_IN_GROUP_MESSAGE,
  TaskMutationError,
} from 'src/shared/services/task-mutation/common';

/** A group member as the assignee, or a TaskMutationError. */
export async function memberOrThrow(groupId: mongoose.Types.ObjectId, userId: string): Promise<IUser> {
  const isMember = await groupMemberService.isMember(groupId, userId);
  const user = isMember ? await User.findById(userId) : null;
  if (!user) throw new TaskMutationError('assignee_not_member', ASSIGNEE_NOT_MEMBER_MESSAGE);
  return user;
}

/** An epic of this group, or a TaskMutationError. */
export async function epicOrThrow(groupId: mongoose.Types.ObjectId, epicId: string): Promise<IEpic> {
  const epic = await epicService.findInGroup(groupId, epicId);
  if (!epic) throw new TaskMutationError('epic_not_in_group', EPIC_NOT_IN_GROUP_MESSAGE);
  return epic;
}
