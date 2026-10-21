import type { ITask, PaginatedResponse, TaskCounts, TaskFilters } from '@tbot/shared';
import { getStatusCategory, isClosedStatus } from '@tbot/shared';
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

import { getUserId } from '@/lib/user';

/**
 * Cache helpers for the paged task lists. Every list query lives under
 * `taskKeys.groupLists(groupId)`:
 *   ['tasks', 'list', groupId, filters]            → InfiniteData<PaginatedResponse<ITask>> (a list, or one board column when filters.status is set)
 *   ['tasks', 'list', groupId, 'counts', filters]  → TaskCounts
 * The helpers below keep those copies in step with a change (status move, create, delete) until
 * the follow-up refetch lands, so a card jumps columns and headers recount immediately.
 */

export type TaskPage = PaginatedResponse<ITask>;
export type TaskPages = InfiniteData<TaskPage, number>;

const LIST_KEY_LENGTH = 4;

function groupListsKey(groupId: string): QueryKey {
  return ['tasks', 'list', groupId];
}

/** Filters of a list query key, or null for a counts key. */
function listFilters(key: QueryKey): TaskFilters | null {
  if (key.length !== LIST_KEY_LENGTH) return null;
  const filters = key[3];
  return filters && typeof filters === 'object' ? (filters as TaskFilters) : null;
}

function countsFilters(key: QueryKey): TaskFilters | null {
  if (key.length !== LIST_KEY_LENGTH + 1 || key[3] !== 'counts') return null;
  return (key[4] ?? {}) as TaskFilters;
}

const idOf = (ref: unknown): string | null => {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object' && '_id' in (ref as object)) return String((ref as { _id: unknown })._id);
  return null;
};

/**
 * Does `task` match a list's filters? `undefined` when the client can't tell (due windows need
 * the group's timezone, `assigneeId=me` needs the caller's id) — callers then leave it to the refetch.
 */
export function matchesTaskFilters(task: ITask, filters: TaskFilters): boolean | undefined {
  if (filters.status && task.status !== filters.status) return false;
  if (filters.category && getStatusCategory(task.status) !== filters.category) return false;
  if ((filters.open || filters.due === 'overdue') && isClosedStatus(task.status)) return false;
  if (filters.type && task.type !== filters.type) return false;
  if (filters.priority && task.priority !== filters.priority) return false;
  if (filters.epicId) {
    const epic = idOf(task.epicId);
    if (filters.epicId === 'none' ? epic !== null : epic !== filters.epicId) return false;
  }
  if (filters.parentTaskId) {
    const parent = idOf(task.parentTaskId);
    if (filters.parentTaskId === 'none' ? parent !== null : parent !== filters.parentTaskId) return false;
  }
  if (filters.search) {
    const q = filters.search.trim().toLocaleLowerCase();
    const number = q.match(/^#?(\d+)$/);
    const text = `${task.title}\n${task.description ?? ''}`.toLocaleLowerCase();
    if (!text.includes(q) && !(number && task.taskNumber === Number(number[1]))) return false;
  }
  let unknown = false;
  if (filters.assigneeId) {
    const assignee = idOf(task.assigneeId);
    if (filters.assigneeId === 'none') {
      if (assignee !== null) return false;
    } else if (filters.assigneeId === 'me') {
      unknown = true;
    } else if (assignee !== filters.assigneeId) {
      return false;
    }
  }
  if (filters.due === 'none') {
    if (task.dueDate) return false;
  } else if (filters.due) {
    unknown = true;
  }
  return unknown ? undefined : true;
}

/** Loaded tasks of a paged list, in order, without duplicates (a task can shift across a page boundary). */
export function flattenTaskPages(data: TaskPages | undefined): ITask[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: ITask[] = [];
  for (const page of data.pages) {
    for (const task of page.data) {
      if (seen.has(task._id)) continue;
      seen.add(task._id);
      out.push(task);
    }
  }
  return out;
}

function withTotal(data: TaskPages, delta: number): TaskPages {
  if (!delta) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({ ...p, meta: { ...p.meta, total: Math.max(0, p.meta.total + delta) } })),
  };
}

/** Newest first (createdAt desc, then _id desc) — the API's default order. */
function isNewer(a: ITask, b: ITask): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a._id > b._id;
}

/** Put `task` where the default order puts it among the loaded pages (or nowhere if it belongs to an unloaded page). */
function insertTask(data: TaskPages, task: ITask): TaskPages {
  const pages = data.pages.map((p) => ({ ...p, data: [...p.data] }));
  for (const page of pages) {
    const index = page.data.findIndex((t) => isNewer(task, t));
    if (index !== -1) {
      page.data.splice(index, 0, task);
      return withTotal({ ...data, pages }, 1);
    }
  }
  const last = pages[pages.length - 1];
  if (last && !last.meta.hasMore) last.data.push(task);
  return withTotal({ ...data, pages }, 1);
}

function removeTask(data: TaskPages, taskId: string): TaskPages {
  let removed = false;
  const pages = data.pages.map((p) => {
    if (!p.data.some((t) => t._id === taskId)) return p;
    removed = true;
    return { ...p, data: p.data.filter((t) => t._id !== taskId) };
  });
  return removed ? withTotal({ ...data, pages }, -1) : data;
}

function findTask(data: TaskPages, taskId: string): ITask | undefined {
  for (const page of data.pages) {
    const task = page.data.find((t) => t._id === taskId);
    if (task) return task;
  }
  return undefined;
}

/** Find the cached copy of a task in any of the group's lists. */
export function findCachedTask(queryClient: QueryClient, groupId: string, taskId: string): ITask | undefined {
  for (const [key, data] of queryClient.getQueriesData<unknown>({ queryKey: groupListsKey(groupId) })) {
    if (!listFilters(key) || !data) continue;
    const task = findTask(data as TaskPages, taskId);
    if (task) return task;
  }
  return undefined;
}

/** Moves one task in / out of the per-status and per-assignee (`"none"` = unassigned) counts. */
function adjustCounts(counts: TaskCounts, task: ITask, delta: number): TaskCounts {
  const byStatus = { ...counts.byStatus } as Record<string, number>;
  byStatus[task.status] = Math.max(0, (byStatus[task.status] ?? 0) + delta);
  const byAssignee = { ...(counts.byAssignee ?? {}) };
  const who = getUserId(task.assigneeId) ?? 'none';
  byAssignee[who] = Math.max(0, (byAssignee[who] ?? 0) + delta);
  return { byStatus, byAssignee, total: Math.max(0, counts.total + delta) };
}

/**
 * Apply a change to every cached list of the group. `before` is the task as cached (null for a new
 * task), `after` the changed task (null when deleted).
 * - A list that holds the task patches it in place, or drops it when it no longer belongs there
 *   (board column whose status it left, or any list it now clearly fails).
 * - A board column / list the task now belongs to gets it inserted in date order (lists with a
 *   custom sort are left to the refetch).
 * - Counts move between statuses.
 */
export function applyTaskChange(
  queryClient: QueryClient,
  groupId: string,
  before: ITask | null,
  after: ITask | null,
): void {
  const taskId = (after ?? before)?._id;
  if (!taskId) return;

  for (const [key, data] of queryClient.getQueriesData<unknown>({ queryKey: groupListsKey(groupId) })) {
    if (!data) continue;

    const filters = listFilters(key);
    if (filters) {
      const pages = data as TaskPages;
      const cached = findTask(pages, taskId);
      let next = pages;
      if (cached) {
        if (!after || matchesTaskFilters(after, filters) === false) {
          next = removeTask(pages, taskId);
        } else {
          next = {
            ...pages,
            pages: pages.pages.map((p) => ({
              ...p,
              data: p.data.map((t) => (t._id === taskId ? { ...t, ...after } : t)),
            })),
          };
        }
      } else if (after && !filters.sort && matchesTaskFilters(after, filters) === true) {
        next = insertTask(pages, after);
      }
      if (next !== pages) queryClient.setQueryData<TaskPages>(key, next);
      continue;
    }

    const cFilters = countsFilters(key);
    if (cFilters) {
      let counts = data as TaskCounts;
      const wasCounted = before ? matchesTaskFilters(before, cFilters) : false;
      const isCounted = after ? matchesTaskFilters(after, cFilters) : false;
      // Unknown either side → leave it to the refetch.
      if (wasCounted === undefined || isCounted === undefined) continue;
      if (wasCounted && before) counts = adjustCounts(counts, before, -1);
      if (isCounted && after) counts = adjustCounts(counts, after, 1);
      if (counts !== data) queryClient.setQueryData<TaskCounts>(key, counts);
    }
  }
}
