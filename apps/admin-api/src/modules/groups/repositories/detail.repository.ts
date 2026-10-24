import { ApiToken, countGroupData, deleteGroupData, GroupDataCounts, TaskActivity, UsageEvent } from '@tbot/db';
import { Types } from 'mongoose';

export function countActivities(groupId: Types.ObjectId): Promise<number> {
  return TaskActivity.countDocuments({ groupId });
}

/** API tokens scoped to the group that are neither revoked nor expired. */
export function countActiveTokens(groupId: Types.ObjectId, now: Date): Promise<number> {
  return ApiToken.countDocuments({ groupId, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });
}

/** Usage events in the window, counted per channel + kind. */
export function usageByChannelKind(
  groupId: Types.ObjectId,
  inRange: { $gte: Date; $lt: Date },
): Promise<{ _id: { channel: string; kind: string }; count: number }[]> {
  return UsageEvent.aggregate([
    { $match: { groupId, createdAt: inRange } },
    { $group: { _id: { channel: '$channel', kind: '$kind' }, count: { $sum: 1 } } },
  ]);
}

export function countGroupDataFor(groupId: Types.ObjectId): Promise<GroupDataCounts> {
  return countGroupData(groupId);
}

export function deleteGroupDataFor(groupId: Types.ObjectId): Promise<GroupDataCounts> {
  return deleteGroupData(groupId);
}
