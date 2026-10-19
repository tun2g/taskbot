import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
  TASK_TYPE_ORDER,
  TaskPriority,
  TaskStatus,
  TaskStatusCategory,
  TaskType,
} from '@tbot/shared';

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
  /** List view only: one status… */
  status?: TaskStatus;
  /** …or a category (mutually exclusive with `status`). */
  category?: StatusCategoryFilter;
  q?: string;
  /** Assignee board: show empty columns for every member. */
  everyone?: boolean;
  /** Status board: show a column for every status, not just the default ones. */
  allStatuses?: boolean;
  /** List view sort (client-side over the loaded tasks). */
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
    status: oneOf(search.status, TASK_STATUS_ORDER),
    category: oneOf(search.category, CATEGORY_FILTERS),
    q: q || undefined,
    everyone: search.everyone === true || search.everyone === 'true' ? true : undefined,
    allStatuses: search.allStatuses === true || search.allStatuses === 'true' ? true : undefined,
    sort: oneOf(search.sort, SORT_KEYS),
    dir: oneOf(search.dir, ['asc', 'desc'] as const),
  };
}

/** Remember the last board search per group so "back" from a task restores the filters. */
const lastSearch = new Map<string, BoardSearch>();
export function rememberBoardSearch(groupId: string, search: BoardSearch) {
  lastSearch.set(groupId, search);
}
export function recallBoardSearch(groupId: string): BoardSearch {
  return lastSearch.get(groupId) ?? {};
}
