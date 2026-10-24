import { ApiToken, GroupMember, User } from '@tbot/db';
import type { AdminPersonTotals, AdminRange, AdminUserRow } from '@tbot/shared';
import { Types } from 'mongoose';
import { iso } from 'src/routes/group-rows';
import { HttpError } from 'src/shared/http';
import { personRef, USER_REF_FIELDS } from 'src/shared/refs';
import { roundUsd } from 'src/stats/aggregate';
import { aiTotalsBy, eventCountsBy } from 'src/stats/queries';
import { rangeWindows } from 'src/stats/range';
import { refusalsBy, sumReasons } from 'src/stats/refusals';

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
export const activeTokenMatch = (now: Date) => ({ revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });

export async function countByUser(model: typeof GroupMember | typeof ApiToken, match: Record<string, unknown>): Promise<Map<string, number>> {
  const res = await (model as typeof GroupMember).aggregate([{ $match: match }, { $group: { _id: '$userId', n: { $sum: 1 } } }]);
  return new Map(res.map((r) => [String(r._id), r.n as number]));
}

export async function findUser(id: Types.ObjectId): Promise<LeanUserDoc> {
  const u = await User.findById(id).select(USER_FIELDS).lean<LeanUserDoc>();
  if (!u) throw new HttpError(404, "This person doesn't exist in the bot's records.");
  return u;
}

/** [start, end) of a range — the one window the list, the person's KPIs and every table footer use. */
export function rangeMatch(range: AdminRange, now = new Date()) {
  const { current } = rangeWindows(range, now);
  return { window: current, createdAt: { $gte: current.start, $lt: current.end } };
}

/** Each person's totals for the range: activity, AI calls / cost and refusals, all from the same window. */
async function personTotals(ids: Types.ObjectId[], createdAt: Record<string, Date>): Promise<Map<string, AdminPersonTotals>> {
  const match = { userId: { $in: ids }, createdAt };
  const [ai, events, refused] = await Promise.all([aiTotalsBy(match, 'userId'), eventCountsBy(match, 'userId'), refusalsBy(match, 'userId')]);
  const totals = (id: string): AdminPersonTotals => {
    const a = ai.get(id);
    return {
      events: events.get(id) ?? 0,
      aiCalls: a?.calls ?? 0,
      aiFailed: a?.failed ?? 0,
      aiCostUsd: roundUsd(a?.costUsd ?? 0),
      aiUnpriced: a?.unpriced ?? 0,
      aiRefused: sumReasons(refused.get(id)),
    };
  };
  return new Map(ids.map((oid) => [String(oid), totals(String(oid))]));
}

/** List rows for these people, with their totals for `range`. */
export async function userRows(users: LeanUserDoc[], range: AdminRange = '30d', now = new Date()): Promise<AdminUserRow[]> {
  if (!users.length) return [];
  const ids = users.map((u) => u._id);
  const [groups, totals, tokens] = await Promise.all([
    countByUser(GroupMember, { userId: { $in: ids } }),
    personTotals(ids, rangeMatch(range, now).createdAt),
    countByUser(ApiToken, { userId: { $in: ids }, ...activeTokenMatch(now) }),
  ]);
  return users.map((u) => {
    const id = String(u._id);
    return {
      person: personRef(u),
      groups: groups.get(id) ?? 0,
      lastSeenAt: iso(u.lastSeenAt),
      range,
      totals: totals.get(id)!,
      activeTokens: tokens.get(id) ?? 0,
      aiDisabled: !!u.ai?.disabled,
      aiDailyLimit: u.ai?.dailyLimit ?? null,
      aiReason: u.ai?.reason ?? null,
      createdAt: iso(u.createdAt) ?? new Date(0).toISOString(),
    };
  });
}
