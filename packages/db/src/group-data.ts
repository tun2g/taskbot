import { Types } from 'mongoose';
import { ApiToken } from './models/api-token.model.js';
import { Epic } from './models/epic.model.js';
import { GroupMember } from './models/group-member.model.js';
import { Group } from './models/group.model.js';
import { TaskActivity } from './models/task-activity.model.js';
import { Task } from './models/task.model.js';

export interface GroupDataCounts {
  tasks: number;
  epics: number;
  members: number;
  activities: number;
  /** MCP tokens limited to this group (they stop working). */
  tokens: number;
}

/**
 * THE list of collections holding a group's own content — keep it next to the models so a new
 * group-owned collection can't be forgotten by the delete. Usage stats and AI cost rows are kept
 * (numbers only, no content) so past totals stay correct.
 */
export async function countGroupData(groupId: Types.ObjectId | string): Promise<GroupDataCounts> {
  const id = new Types.ObjectId(String(groupId));
  const [tasks, epics, members, activities, tokens] = await Promise.all([
    Task.countDocuments({ groupId: id }),
    Epic.countDocuments({ groupId: id }),
    GroupMember.countDocuments({ groupId: id }),
    TaskActivity.countDocuments({ groupId: id }),
    ApiToken.countDocuments({ groupId: id, revokedAt: null }),
  ]);
  return { tasks, epics, members, activities, tokens };
}

/** Permanently deletes the group and its content; revokes group-scoped MCP tokens. Returns what was removed. */
export async function deleteGroupData(groupId: Types.ObjectId | string): Promise<GroupDataCounts> {
  const id = new Types.ObjectId(String(groupId));
  const [tasks, epics, members, activities, tokens] = await Promise.all([
    Task.deleteMany({ groupId: id }),
    Epic.deleteMany({ groupId: id }),
    GroupMember.deleteMany({ groupId: id }),
    TaskActivity.deleteMany({ groupId: id }),
    ApiToken.updateMany({ groupId: id, revokedAt: null }, { $set: { revokedAt: new Date() } }),
  ]);
  await Group.deleteOne({ _id: id });
  return {
    tasks: tasks.deletedCount,
    epics: epics.deletedCount,
    members: members.deletedCount,
    activities: activities.deletedCount,
    tokens: tokens.modifiedCount,
  };
}
