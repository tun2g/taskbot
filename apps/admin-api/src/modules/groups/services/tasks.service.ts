import type { AdminGroupEpicRow, AdminGroupTaskCounts, AdminGroupTaskFilter, AdminGroupTaskRow } from '@tbot/shared';
import { Types } from 'mongoose';
import { findGroup } from 'src/modules/groups/groups.service';
import { TASK_FILTERS } from 'src/modules/groups/groups.schemas';
import {
  countEpics,
  countTasks,
  epicTaskCounts,
  findCreatedVia,
  findEpics,
  findEpicTitles,
  findTaskNumbers,
  findTasks,
  LeanTaskRow,
} from 'src/modules/groups/repositories/tasks.repository';
import { iso } from 'src/shared/format';
import type { Pagination } from 'src/shared/http';
import { searchRegex } from 'src/shared/http';
import { loadPersonRefs } from 'src/shared/refs';
import { CLOSED_STATUSES } from 'src/stats/queries';
import { parseRange, rangeWindows } from 'src/stats/range';

export function taskFilterMatch(filter: AdminGroupTaskFilter, now: Date): Record<string, unknown> {
  switch (filter) {
    case 'open':
      return { status: { $nin: CLOSED_STATUSES } };
    case 'overdue':
      return { status: { $nin: CLOSED_STATUSES }, dueDate: { $ne: null, $lt: now } };
    case 'done':
      return { status: { $in: CLOSED_STATUSES } };
    default:
      return {};
  }
}

/** Group + ?createdIn= + ?q= (title, or #number). The filter is applied on top. */
export function taskBaseMatch(groupId: Types.ObjectId, query: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = { groupId };
  if (query.createdIn) {
    const { current } = rangeWindows(parseRange(query.createdIn));
    base.createdAt = { $gte: current.start, $lt: current.end };
  }
  const q = typeof query.q === 'string' ? query.q.trim().replace(/^#/, '') : '';
  const re = searchRegex(q);
  if (re) base.$or = /^\d+$/.test(q) ? [{ title: re }, { taskNumber: Number(q) }] : [{ title: re }];
  return base;
}

const SORTS: Record<AdminGroupTaskFilter, Record<string, 1 | -1>> = {
  overdue: { dueDate: 1, _id: 1 },
  done: { completedAt: -1, createdAt: -1, _id: -1 },
  open: { createdAt: -1, _id: -1 },
  all: { createdAt: -1, _id: -1 },
};

/** One page of tasks for the filter, plus how many tasks every filter has. */
export async function taskPage(base: Record<string, unknown>, filter: AdminGroupTaskFilter, p: Pagination, now: Date) {
  const [docs, countList] = await Promise.all([
    findTasks({ ...base, ...taskFilterMatch(filter, now) }, SORTS[filter], p),
    Promise.all(TASK_FILTERS.map((f) => countTasks({ ...base, ...taskFilterMatch(f, now) }))),
  ]);
  const counts = Object.fromEntries(TASK_FILTERS.map((f, i) => [f, countList[i] ?? 0])) as AdminGroupTaskCounts;
  return { docs, counts };
}

/** Rows with the assignee, parent number, epic title and where each task was created. */
export async function taskRows(docs: LeanTaskRow[], now: Date): Promise<AdminGroupTaskRow[]> {
  const ids = docs.map((d) => d._id);
  const parentIds = docs.map((d) => d.parentTaskId).filter((v): v is Types.ObjectId => !!v);
  const epicIds = docs.map((d) => d.epicId).filter((v): v is Types.ObjectId => !!v);
  const [people, parents, epics, created] = await Promise.all([
    loadPersonRefs(docs.map((d) => d.assigneeId)),
    findTaskNumbers(parentIds),
    findEpicTitles(epicIds),
    findCreatedVia(ids),
  ]);
  const parentNo = new Map(parents.map((t) => [String(t._id), t.taskNumber]));
  const epicTitle = new Map(epics.map((e) => [String(e._id), e.title]));
  const via = new Map(created.map((a) => [String(a.taskId), a.via]));
  const closed = new Set(CLOSED_STATUSES);

  return docs.map((d) => {
    const epic = d.epicId ? epicTitle.get(String(d.epicId)) : undefined;
    return {
      id: String(d._id),
      number: d.taskNumber,
      title: d.title,
      status: d.status,
      parentNumber: d.parentTaskId ? (parentNo.get(String(d.parentTaskId)) ?? null) : null,
      epic: d.epicId && epic !== undefined ? { id: String(d.epicId), title: epic } : null,
      assignee: d.assigneeId ? (people.get(String(d.assigneeId)) ?? null) : null,
      dueDate: iso(d.dueDate),
      overdue: !!d.dueDate && !closed.has(d.status) && new Date(d.dueDate) < now,
      createdAt: iso(d.createdAt) ?? now.toISOString(),
      completedAt: iso(d.completedAt),
      createdVia: via.get(String(d._id)) ?? null,
    };
  });
}

/** One page of the group's epics (open first) with their task counts. */
export async function epicPage(
  groupId: Types.ObjectId,
  p: Pagination,
): Promise<{ rows: AdminGroupEpicRow[]; total: number }> {
  const [total, docs] = await Promise.all([countEpics(groupId), findEpics(groupId, p)]);
  const byEpic = await epicTaskCounts(
    groupId,
    docs.map((d) => d._id),
  );
  const rows = docs.map((d) => ({
    id: String(d._id),
    title: d.title,
    status: d.status,
    tasks: byEpic.get(String(d._id))?.tasks ?? 0,
    openTasks: byEpic.get(String(d._id))?.open ?? 0,
    createdAt: iso(d.createdAt) ?? new Date(0).toISOString(),
  }));
  return { rows, total };
}

/** The tasks list behind the group's task numbers: one page, plus how many tasks every filter has. */
export async function listTasks(
  id: Types.ObjectId,
  query: Record<string, unknown>,
  filter: AdminGroupTaskFilter,
  p: Pagination,
) {
  await findGroup(id);
  const now = new Date();
  const { docs, counts } = await taskPage(taskBaseMatch(id, query), filter, p, now);
  return { rows: await taskRows(docs, now), counts };
}

/** The epics behind the group's "Epics" count, open ones first. */
export async function listEpics(
  id: Types.ObjectId,
  p: Pagination,
): Promise<{ rows: AdminGroupEpicRow[]; total: number }> {
  await findGroup(id);
  return epicPage(id, p);
}
