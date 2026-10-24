import { ApiToken, GroupMember, User, UsageEvent } from '@tbot/db';
import { AI_LIMITER } from '@tbot/shared';
import { Types } from 'mongoose';
import type { Pagination } from 'src/shared/http';
import { getKv } from 'src/shared/redis';
import { USER_REF_FIELDS } from 'src/shared/refs';
import { DAY_EXPR } from 'src/stats/queries';

export interface LeanUserDoc {
  _id: Types.ObjectId;
  telegramUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  lastSeenAt?: Date | null;
  ai?: { disabled?: boolean; dailyLimit?: number | null; reason?: string | null } | null;
  createdAt: Date;
}

export const USER_FIELDS = `${USER_REF_FIELDS} lastSeenAt ai createdAt`;
const activeTokenMatch = (now: Date) => ({ revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });

async function countByUser(model: typeof GroupMember | typeof ApiToken, match: Record<string, unknown>): Promise<Map<string, number>> {
  const res = await (model as typeof GroupMember).aggregate([{ $match: match }, { $group: { _id: '$userId', n: { $sum: 1 } } }]);
  return new Map(res.map((r) => [String(r._id), r.n as number]));
}

/** How many groups each of these people is a member of. */
export async function groupCountsByUser(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  return countByUser(GroupMember, { userId: { $in: ids } });
}

/** How many active MCP tokens each of these people has at `now`. */
export async function activeTokenCountsByUser(ids: Types.ObjectId[], now: Date): Promise<Map<string, number>> {
  return countByUser(ApiToken, { userId: { $in: ids }, ...activeTokenMatch(now) });
}

export async function findUserById(id: Types.ObjectId): Promise<LeanUserDoc | null> {
  return User.findById(id).select(USER_FIELDS).lean<LeanUserDoc>();
}

export async function countUsers(filter: Record<string, unknown>): Promise<number> {
  return User.countDocuments(filter);
}

/** One page of people, most recently seen first. */
export async function findUsersByLastSeen(filter: Record<string, unknown>, p: Pagination): Promise<LeanUserDoc[]> {
  return User.find(filter).select(USER_FIELDS).sort({ lastSeenAt: -1, createdAt: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean<LeanUserDoc[]>();
}

/** Every matching person's id and join date (for ranking by a metric). */
export async function findUserIds(filter: Record<string, unknown>): Promise<{ _id: Types.ObjectId; createdAt: Date }[]> {
  return User.find(filter).select('_id createdAt').lean<{ _id: Types.ObjectId; createdAt: Date }[]>();
}

export async function findUsersByIds(ids: Types.ObjectId[]): Promise<LeanUserDoc[]> {
  return User.find({ _id: { $in: ids } }).select(USER_FIELDS).lean<LeanUserDoc[]>();
}

/** People with any usage event since `since`. */
export async function activeUserIds(since: Date): Promise<unknown[]> {
  return UsageEvent.distinct('userId', { createdAt: { $gte: since }, userId: { $ne: null } });
}

/** People who own an active MCP token. */
export async function tokenOwnerIds(now: Date): Promise<unknown[]> {
  return ApiToken.distinct('userId', activeTokenMatch(now));
}

export async function findMemberships(userId: Types.ObjectId): Promise<{ groupId: Types.ObjectId; joinedAt?: Date }[]> {
  return GroupMember.find({ userId }).select('groupId joinedAt').lean<{ groupId: Types.ObjectId; joinedAt?: Date }[]>();
}

/** Usage events per day for a match. */
export async function eventCountsByDay(match: Record<string, unknown>): Promise<{ _id: unknown; n: number }[]> {
  return UsageEvent.aggregate([{ $match: match }, { $group: { _id: DAY_EXPR('createdAt'), n: { $sum: 1 } } }]);
}

/** The person's daily AI limiter count for `day` (shared Redis); null when Redis can't be read. */
export async function personDailyAiCount(telegramUserId: number, day: string): Promise<number | null> {
  return getKv()
    .get(`ratelimit:${AI_LIMITER.personDaily}:${day}:${telegramUserId}`)
    .then((v) => (v == null ? 0 : Number(v)))
    .catch(() => null);
}

export async function setUserFields(id: Types.ObjectId, set: Record<string, unknown>): Promise<void> {
  await User.updateOne({ _id: id }, { $set: set });
}

/** Revokes every active MCP token of this person; returns how many were revoked. */
export async function revokeTokensOf(userId: Types.ObjectId): Promise<number> {
  const result = await ApiToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return result.modifiedCount ?? 0;
}
