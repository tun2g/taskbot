import type { AiBoardFilters } from '@tbot/shared';

import type { BoardSearch, StatusCategoryFilter } from '@/pages/tasks/board-search';
import { validateBoardSearch } from '@/pages/tasks/board-search';

/**
 * The board (list view) showing exactly the tasks an AI answer matched: its filters mapped onto the board's URL
 * search. Null when the answer can't be shown as a board view (e.g. "subtasks of #42").
 */
export function boardSearchFromAi(filters: AiBoardFilters | undefined): BoardSearch | null {
  if (!filters) return null;
  const parent = filters.parentTaskId;
  if (parent && parent !== 'none') return null;
  const category: StatusCategoryFilter | undefined = filters.open ? 'open' : filters.category;
  // Through the same validation as a typed URL, so an unexpected value is dropped rather than breaking the board.
  return validateBoardSearch({
    view: 'list',
    status: category ? undefined : filters.status,
    category,
    type: filters.type,
    priority: filters.priority,
    assignee: filters.assigneeId,
    epic: filters.epicId,
    due: filters.due,
    q: filters.search,
    subtasks: parent === 'none' ? 'hide' : undefined,
  });
}
