import type { AiBoardFilters } from '@tbot/shared';
import { IUser } from 'src/database/models/user.model';
import type { QueryAction } from 'src/shared/services/ai-command/plan.schema';
import type { EpicRef } from 'src/shared/services/ai-command/result';

/**
 * An /ai list query ("việc quá hạn của @an", "bugs matching login") as the board's list filters, so the
 * Mini App's "View all N on board" shows the same N tasks. Mirrors runQuery: without a status only open tasks
 * count, and overdue means open with a due day before today.
 */
export function queryBoardFilters(q: QueryAction, assignee: IUser | null, epic: EpicRef | undefined): AiBoardFilters {
  return {
    ...(q.status ? { status: q.status as AiBoardFilters['status'] } : { open: true }),
    ...(q.type ? { type: q.type as AiBoardFilters['type'] } : {}),
    ...(assignee ? { assigneeId: String(assignee._id) } : {}),
    ...(q.text ? { search: q.text } : {}),
    ...(epic ? { epicId: String(epic._id) } : {}),
    ...(q.kind === 'overdue' ? { due: 'overdue' as const } : {}),
  };
}
