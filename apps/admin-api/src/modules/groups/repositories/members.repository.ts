import { ApiToken, GroupMember, Task, User, UsageEvent } from '@tbot/db';
import { Types } from 'mongoose';
import { LeanUser, USER_REF_FIELDS } from 'src/shared/refs';

export interface MemberDoc {
  userId: Types.ObjectId;
  telegramUserId: number;
  joinedAt?: Date;
}

type InRange = { $gte: Date; $lt: Date };

/** Everyone linked to the group (no cap). */
export function findMemberDocs(groupId: Types.ObjectId): Promise<MemberDoc[]> {
  return GroupMember.find({ groupId }).select('userId telegramUserId joinedAt').lean<MemberDoc[]>();
}

/** Ids of the given users whose first name, last name or @username matches. */
export function findUserIdsMatching(userIds: Types.ObjectId[], re: RegExp): Promise<{ _id: Types.ObjectId }[]> {
  return User.find({ _id: { $in: userIds }, $or: [{ firstName: re }, { lastName: re }, { username: re }] })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();
}

/** Usage events per person in the window. */
export async function eventsByUser(groupId: Types.ObjectId, inRange: InRange): Promise<Map<string, number>> {
  const rows = await UsageEvent.aggregate([
    { $match: { groupId, createdAt: inRange, userId: { $ne: null } } },
    { $group: { _id: '$userId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((e) => [String(e._id), e.n as number]));
}

/** Tasks created per person in the window. */
export async function tasksCreatedByUser(groupId: Types.ObjectId, inRange: InRange): Promise<Map<string, number>> {
  const rows = await Task.aggregate([
    { $match: { groupId, createdAt: inRange } },
    { $group: { _id: '$createdBy', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((t) => [String(t._id), t.n as number]));
}

/** Last time each person used the bot in this group (usage events are kept 90 days). */
export async function lastHereByUser(groupId: Types.ObjectId): Promise<Map<string, Date>> {
  const rows = await UsageEvent.aggregate([
    { $match: { groupId, userId: { $ne: null } } },
    { $group: { _id: '$userId', at: { $max: '$createdAt' } } },
  ]);
  return new Map(rows.map((e) => [String(e._id), e.at as Date]));
}

/** Tokens that reach this group: scoped to it, or to all of the person's groups. */
export async function activeTokensByUser(
  groupId: Types.ObjectId,
  userIds: Types.ObjectId[],
  now: Date,
): Promise<Map<string, number>> {
  const rows = userIds.length
    ? await ApiToken.aggregate([
        {
          $match: {
            userId: { $in: userIds },
            revokedAt: null,
            $and: [
              { $or: [{ groupId }, { groupId: null }] },
              { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
            ],
          },
        },
        { $group: { _id: '$userId', n: { $sum: 1 } } },
      ])
    : [];
  return new Map(rows.map((t) => [String(t._id), t.n as number]));
}

/** The people on one page (person-ref fields + lastSeenAt). */
export function findMemberUsers(userIds: Types.ObjectId[]): Promise<(LeanUser & { lastSeenAt?: Date | null })[]> {
  return User.find({ _id: { $in: userIds } })
    .select(`${USER_REF_FIELDS} lastSeenAt`)
    .lean<(LeanUser & { lastSeenAt?: Date | null })[]>();
}
