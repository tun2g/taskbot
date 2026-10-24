import { AiCall, Group } from '@tbot/db';
import { GroupStatus } from '@tbot/shared';
import { Types } from 'mongoose';
import { GROUP_FIELDS, LeanGroup } from 'src/modules/groups/groups.repository';
import { getKv } from 'src/shared/redis';

/** Of these ids, the groups that still exist. */
export async function existingGroupIds(ids: string[]): Promise<Set<string>> {
  const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (!valid.length) return new Set();
  const docs = await Group.find({ _id: { $in: valid } }).select('_id').lean<{ _id: Types.ObjectId }[]>();
  return new Set(docs.map((d) => String(d._id)));
}

/**
 * Today's AI numbers. Calls refused by the daily call limit ("quota" rows) are recorded too, but they aren't
 * calls to the provider and don't count toward the limit — counting them would show "612 / 500 calls".
 */
export const AI_TODAY_GROUP = {
  cost: { $sum: '$costUsd' },
  calls: { $sum: { $cond: [{ $in: ['$status', ['quota', 'disabled']] }, 0, 1] } },
  blocked: { $sum: { $cond: [{ $in: ['$status', ['quota', 'disabled']] }, 1, 0] } },
};

/** `{ _id: status, n }` per group status that has groups. */
export function groupStatusRows(): Promise<{ _id: string; n: number }[]> {
  return Group.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
}

/** The oldest groups waiting for approval. */
export async function oldestPendingGroups(limit: number): Promise<LeanGroup[]> {
  return Group.find({ status: GroupStatus.PENDING }).select(GROUP_FIELDS).sort({ addedAt: 1, createdAt: 1 }).limit(limit).lean<LeanGroup[]>();
}

/** AI cost, calls and blocked calls since `since` (one row, or none when there were no calls). */
export function aiTotalsSince(since: Date): Promise<{ cost: number; calls: number; blocked: number }[]> {
  return AiCall.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: null, ...AI_TODAY_GROUP } }]);
}

/** Does the cache (Redis) answer? */
export function redisReachable(): Promise<boolean> {
  return getKv()
    .ping()
    .then(() => true)
    .catch(() => false);
}
