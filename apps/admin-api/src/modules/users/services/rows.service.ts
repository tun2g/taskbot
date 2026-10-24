import type { AdminPersonTotals, AdminRange, AdminUserRow } from '@tbot/shared';
import { Types } from 'mongoose';
import { rangeMatch } from 'src/modules/users/helpers/range-match';
import { activeTokenCountsByUser, findUserById, groupCountsByUser, LeanUserDoc } from 'src/modules/users/users.repository';
import { iso } from 'src/shared/format';
import { HttpError } from 'src/shared/http';
import { personRef } from 'src/shared/refs';
import { roundUsd } from 'src/stats/aggregate';
import { aiTotalsBy, eventCountsBy } from 'src/stats/queries';
import { refusalsBy, sumReasons } from 'src/stats/refusals';

export async function findUser(id: Types.ObjectId): Promise<LeanUserDoc> {
  const u = await findUserById(id);
  if (!u) throw new HttpError(404, "This person doesn't exist in the bot's records.");
  return u;
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
    groupCountsByUser(ids),
    personTotals(ids, rangeMatch(range, now).createdAt),
    activeTokenCountsByUser(ids, now),
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
