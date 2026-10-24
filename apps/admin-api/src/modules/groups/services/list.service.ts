import type { AdminGroupRow } from '@tbot/shared';
import { GROUP_STATUS_VALUES } from '@tbot/shared';
import { Types } from 'mongoose';
import { LeanGroup, taskCountsBy } from 'src/modules/groups/groups.repository';
import { GroupSort } from 'src/modules/groups/groups.schemas';
import {
  countGroups,
  findGroupIds,
  findGroupsByIds,
  findGroupsSorted,
} from 'src/modules/groups/repositories/list.repository';
import { groupRows } from 'src/modules/groups/services/rows.service';
import type { Pagination } from 'src/shared/http';
import { searchRegex } from 'src/shared/http';
import { GroupActivity, isActive, roundUsd } from 'src/stats/aggregate';
import { aiTotalsBy, groupActivity, lastRolledDay } from 'src/stats/queries';
import { lastDays, parseRange, rangeWindows } from 'src/stats/range';

/** Mongo filter for ?status= (comma list) and ?q= (name or Telegram chat id). */
export function listFilter(query: Record<string, unknown>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const status = String(query.status ?? '');
  if (status) {
    const list = status.split(',').filter((s) => (GROUP_STATUS_VALUES as string[]).includes(s));
    if (list.length) filter.status = { $in: list };
  }
  const re = searchRegex(query.q);
  if (re) {
    const or: Record<string, unknown>[] = [{ groupName: re }];
    const q = String(query.q).trim();
    if (/^-?\d+$/.test(q)) or.push({ telegramGroupId: Number(q) });
    filter.$or = or;
  }
  return filter;
}

export interface ListPeriod {
  window: { start: Date; end: Date };
  activity: Map<string, GroupActivity>;
}

/** ?activeIn=30d — the groups with activity in that window (the overview's "Groups with activity"). */
export async function loadPeriod(activeIn: unknown): Promise<ListPeriod> {
  const { current } = rangeWindows(parseRange(activeIn));
  const activity = await groupActivity(current, await lastRolledDay());
  return { window: current, activity: new Map([...activity.entries()].filter(([, a]) => isActive(a))) };
}

export const periodIdFilter = (period: ListPeriod) => ({
  $in: [...period.activity.keys()].filter((k) => Types.ObjectId.isValid(k)).map((k) => new Types.ObjectId(k)),
});

/** Ranks every matching group by `score`, then loads one page of them in that order. */
async function rankedPage(
  filter: Record<string, unknown>,
  p: Pagination,
  score: (ids: Types.ObjectId[]) => Promise<Map<string, number>>,
) {
  const all = await findGroupIds(filter);
  const metric = await score(all.map((g) => g._id));
  const ranked = all
    .sort((a, b) => (metric.get(String(b._id)) ?? 0) - (metric.get(String(a._id)) ?? 0) || +b.createdAt - +a.createdAt)
    .slice(p.skip, p.skip + p.limit)
    .map((g) => g._id);
  const docs = await findGroupsByIds(ranked);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ranked.map((id) => byId.get(String(id))).filter((g): g is LeanGroup => !!g);
}

const MONGO_SORTS: Partial<Record<GroupSort, Record<string, 1 | -1>>> = {
  lastActivity: { lastActivityAt: -1, createdAt: -1, _id: -1 },
  added: { addedAt: -1, createdAt: -1, _id: -1 },
  members: { memberCount: -1, _id: -1 },
};

/** One page of groups in the requested order. In a period, "activity" and "tasks" rank by the period's numbers. */
export async function loadPage(
  filter: Record<string, unknown>,
  sort: GroupSort,
  p: Pagination,
  period: ListPeriod | null,
): Promise<LeanGroup[]> {
  if (period && (sort === 'lastActivity' || sort === 'tasks')) {
    const score = (id: string) => {
      const a = period.activity.get(id);
      return sort === 'tasks' ? (a?.tasksCreated ?? 0) : (a?.events ?? 0);
    };
    return rankedPage(filter, p, async (ids) => new Map(ids.map((id) => [String(id), score(String(id))])));
  }
  const mongoSort = MONGO_SORTS[sort];
  if (mongoSort) return findGroupsSorted(filter, mongoSort, p);
  if (sort === 'tasks') {
    return rankedPage(
      filter,
      p,
      async (ids) =>
        new Map([...(await taskCountsBy({ groupId: { $in: ids } })).entries()].map(([k, v]) => [k, v.tasks])),
    );
  }
  return rankedPage(filter, p, async (ids) => {
    const ai = await aiTotalsBy({ groupId: { $in: ids }, createdAt: { $gte: lastDays(30).start } }, 'groupId');
    return new Map([...ai.entries()].map(([k, v]) => [k, v.costUsd]));
  });
}

/** Fills `inPeriod`; the AI numbers come straight from the AI calls so cost, calls and unpriced agree. */
export async function addPeriodNumbers(rows: AdminGroupRow[], page: LeanGroup[], period: ListPeriod): Promise<void> {
  const ai = await aiTotalsBy(
    { groupId: { $in: page.map((g) => g._id) }, createdAt: { $gte: period.window.start, $lt: period.window.end } },
    'groupId',
  );
  for (const r of rows) {
    const a = period.activity.get(r.id);
    const t = ai.get(r.id);
    r.inPeriod = {
      events: a?.events ?? 0,
      tasksCreated: a?.tasksCreated ?? 0,
      aiCalls: t?.calls ?? a?.aiCalls ?? 0,
      aiCostUsd: roundUsd(t?.costUsd ?? a?.aiCostUsd ?? 0),
      aiUnpriced: t?.unpriced ?? 0,
    };
  }
}

/** One page of list rows (+ the period's numbers with ?activeIn=) and the total matching. */
export async function listGroups(
  query: Record<string, unknown>,
  sort: GroupSort,
  p: Pagination,
): Promise<{ rows: AdminGroupRow[]; total: number }> {
  const filter = listFilter(query);
  const period = query.activeIn ? await loadPeriod(query.activeIn) : null;
  if (period) filter._id = periodIdFilter(period);

  const total = await countGroups(filter);
  const page = await loadPage(filter, sort, p, period);
  const rows = await groupRows(page);
  if (period) await addPeriodNumbers(rows, page, period);
  return { rows, total };
}
