import type { AdminRange, AdminUserRow } from '@tbot/shared';
import { Types } from 'mongoose';
import { rangeMatch } from 'src/modules/users/helpers/range-match';
import { UserSort } from 'src/modules/users/helpers/sorts';
import { userRows } from 'src/modules/users/services/rows.service';
import {
  activeTokenCountsByUser,
  activeUserIds,
  countUsers,
  findUserIds,
  findUsersByIds,
  findUsersByLastSeen,
  LeanUserDoc,
  tokenOwnerIds,
} from 'src/modules/users/users.repository';
import { Pagination, searchRegex } from 'src/shared/http';
import { aiTotalsBy, eventCountsBy } from 'src/stats/queries';
import { lastDays } from 'src/stats/range';

/** The list's ?q=&activeIn=&hasTokens= as sent (each is checked here). */
export interface UserListQuery {
  q: unknown;
  activeIn: unknown;
  hasTokens: unknown;
}

/** Start of the DAU / WAU / MAU window for ?activeIn= (null = no filter). Same windows as the overview. */
export function activeSince(value: unknown, now = new Date()): Date | null {
  const days = value === 'today' ? 1 : value === '7d' ? 7 : value === '30d' ? 30 : 0;
  return days ? lastDays(days, now).start : null;
}

/** The users filter for ?q=&activeIn=&hasTokens=. */
export async function userFilter(query: UserListQuery): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {};
  const re = searchRegex(query.q);
  if (re) {
    const q = String(query.q).trim().replace(/^@/, '');
    const or: Record<string, unknown>[] = [{ username: searchRegex(q) }, { firstName: re }, { lastName: re }];
    if (/^\d+$/.test(q)) or.push({ telegramUserId: Number(q) });
    filter.$or = or;
  }
  // ?activeIn=today|7d|30d — the people behind DAU / WAU / MAU (same rule: any usage event since the window start).
  const since = activeSince(query.activeIn);
  if (since) {
    const ids = await activeUserIds(since);
    filter._id = { $in: ids };
  }
  // ?hasTokens=1 — the people behind MCP "Active tokens".
  if (query.hasTokens === '1' || query.hasTokens === 'true') {
    const owners = await tokenOwnerIds(new Date());
    const prev = filter._id as { $in: unknown[] } | undefined;
    const set = new Set(owners.map(String));
    filter._id = { $in: prev ? prev.$in.filter((x) => set.has(String(x))) : owners };
  }
  return filter;
}

/** The number a non-date sort ranks people by (in the range, or active tokens now). */
async function sortMetric(sort: Exclude<UserSort, 'lastSeen'>, ids: Types.ObjectId[], createdAt: Record<string, Date>): Promise<Map<string, number>> {
  const match = { userId: { $in: ids }, createdAt };
  if (sort === 'events') return eventCountsBy(match, 'userId');
  if (sort === 'tokens') return activeTokenCountsByUser(ids, new Date());
  const ai = await aiTotalsBy(match, 'userId');
  return new Map([...ai.entries()].map(([k, v]) => [k, sort === 'aiCost' ? v.costUsd : v.calls]));
}

/** One page of people in `sort` order. */
export async function userPage(filter: Record<string, unknown>, sort: UserSort, range: AdminRange, p: Pagination): Promise<LeanUserDoc[]> {
  if (sort === 'lastSeen') return findUsersByLastSeen(filter, p);
  const all = await findUserIds(filter);
  const metric = await sortMetric(sort, all.map((u) => u._id), rangeMatch(range).createdAt);
  const ranked = all
    .sort((a, b) => (metric.get(String(b._id)) ?? 0) - (metric.get(String(a._id)) ?? 0) || +b.createdAt - +a.createdAt)
    .slice(p.skip, p.skip + p.limit)
    .map((u) => u._id);
  const docs = await findUsersByIds(ranked);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ranked.map((id) => byId.get(String(id))).filter((u): u is LeanUserDoc => !!u);
}

/** GET /users — one page of rows in `sort` order, and how many people match in all. */
export async function listUsers(query: UserListQuery, sort: UserSort, range: AdminRange, p: Pagination): Promise<{ rows: AdminUserRow[]; total: number }> {
  const filter = await userFilter(query);
  const [total, page] = await Promise.all([countUsers(filter), userPage(filter, sort, range, p)]);
  return { rows: await userRows(page, range), total };
}
