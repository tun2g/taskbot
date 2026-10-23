import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
  TASK_TYPE_ORDER,
  TaskPriority,
  TaskStatus,
  TaskStatusCategory,
  TaskType,
} from '@tbot/shared';
import type { TaskDueFilter } from '@tbot/shared';

import { isObjectId } from '@/lib/epics';

export const DUE_FILTERS: TaskDueFilter[] = ['overdue', 'today', 'week', 'none'];

/** List-view status filter by category; `open` = every status that isn't closed. */
export type StatusCategoryFilter = 'open' | TaskStatusCategory;
const CATEGORY_FILTERS: StatusCategoryFilter[] = [
  'open',
  TaskStatusCategory.TODO,
  TaskStatusCategory.IN_PROGRESS,
  TaskStatusCategory.DONE,
];

export type BoardView = 'list' | 'board';
export type ListSortKey = 'type' | 'key' | 'summary' | 'status' | 'priority' | 'assignee' | 'due';
const SORT_KEYS: ListSortKey[] = ['type', 'key', 'summary', 'status', 'priority', 'assignee', 'due'];
export type BoardGroupBy = 'status' | 'assignee';

/** URL search params of /$groupId/tasks — the board's filters live in the URL. */
export interface BoardSearch {
  view?: BoardView;
  groupBy?: BoardGroupBy;
  type?: TaskType;
  /** A member `_id`, `"me"` or `"none"` (unassigned). */
  assignee?: string;
  priority?: TaskPriority;
  /** An epic `_id`, or `"none"` for tasks without an epic. */
  epic?: string;
  /** Due window by calendar day in the group's timezone (overdue = past due and still open). */
  due?: TaskDueFilter;
  /** List view only: one status… */
  status?: TaskStatus;
  /** …or a category (mutually exclusive with `status`). */
  category?: StatusCategoryFilter;
  q?: string;
  /** Assignee board: show empty columns for every member. */
  everyone?: boolean;
  /** Status board: show a column for every status, not just the default ones. */
  allStatuses?: boolean;
  /**
   * Like Jira, the board shows top-level tasks only (a parent card carries its subtask progress) and the list shows
   * everything. `show` / `hide` override that per view; "Clear filters" resets `hide`.
   */
  subtasks?: 'show' | 'hide';
  /** List view sort (done by the API, so every page follows it). */
  sort?: ListSortKey;
  dir?: 'asc' | 'desc';
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function validateBoardSearch(search: Record<string, unknown>): BoardSearch {
  const assignee = typeof search.assignee === 'string' && search.assignee ? search.assignee : undefined;
  const q = typeof search.q === 'string' || typeof search.q === 'number' ? String(search.q).trim() : '';
  return {
    view: oneOf(search.view, ['list', 'board'] as const),
    groupBy: oneOf(search.groupBy, ['status', 'assignee'] as const),
    type: oneOf(search.type, TASK_TYPE_ORDER),
    assignee,
    priority: oneOf(search.priority, TASK_PRIORITY_ORDER),
    // An epic id or "none"; anything else (a hand-edited / cut-off link) is dropped instead of breaking the board.
    epic: search.epic === 'none' || isObjectId(search.epic) ? search.epic : undefined,
    due: oneOf(search.due, DUE_FILTERS),
    status: oneOf(search.status, TASK_STATUS_ORDER),
    category: oneOf(search.category, CATEGORY_FILTERS),
    q: q || undefined,
    everyone: search.everyone === true || search.everyone === 'true' ? true : undefined,
    allStatuses: search.allStatuses === true || search.allStatuses === 'true' ? true : undefined,
    subtasks: oneOf(search.subtasks, ['show', 'hide'] as const),
    sort: oneOf(search.sort, SORT_KEYS),
    dir: oneOf(search.dir, ['asc', 'desc'] as const),
  };
}

/** Whether subtasks are left out: the board hides them unless asked to show them, the list the other way round. */
export function subtasksHidden(search: BoardSearch, view: BoardView): boolean {
  return search.subtasks ? search.subtasks === 'hide' : view === 'board';
}

/** Remember the last board search per group so "back" from a task restores the filters. */
const lastSearch = new Map<string, BoardSearch>();
export function rememberBoardSearch(groupId: string, search: BoardSearch) {
  lastSearch.set(groupId, search);
}
export function recallBoardSearch(groupId: string): BoardSearch {
  return lastSearch.get(groupId) ?? {};
}
/** An epic was deleted: "back" must not land on a board filtered to it. */
export function forgetEpicInBoardSearch(groupId: string, epicId: string) {
  const last = lastSearch.get(groupId);
  if (last?.epic === epicId) lastSearch.set(groupId, { ...last, epic: undefined });
}
