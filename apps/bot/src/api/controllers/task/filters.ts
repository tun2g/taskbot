import { isClosedStatus, statusesInCategory, TASK_STATUS_ORDER, TaskStatusCategory } from '@tbot/shared';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { SIGN_IN_MESSAGE } from 'src/api/controllers/task/respond';
import { sendError, validationMessage } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { overdueCutoff, resolveGroupTimezone } from 'src/api/timezone';
import { TaskDueFilter, taskQuerySchema } from 'src/api/validation';
import { groupService } from 'src/database/services/group.service';
import { TaskFilters } from 'src/database/services/task.service';

/**
 * Combine `status`, `category` and `open` into the set of statuses to match.
 * Returns undefined when no status filter applies.
 */
export function resolveStatusFilter(query: {
  status?: string;
  category?: string;
  open?: boolean;
}): string[] | undefined {
  if (!query.status && !query.category && !query.open) return undefined;
  let statuses: string[] = query.category
    ? statusesInCategory(query.category as TaskStatusCategory)
    : [...TASK_STATUS_ORDER];
  if (query.open) statuses = statuses.filter((s) => !isClosedStatus(s));
  if (query.status) statuses = statuses.filter((s) => s === query.status);
  return statuses;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Translate `due` into a dueDate range. Due dates are stored at 00:00Z of their calendar day,
 * and "today" is the group's local date (as 00:00Z), so day comparisons are plain Date ranges.
 * `overdue` also implies "not closed" — see resolveStatusFilter's `open`.
 */
export function resolveDueFilter(
  due: TaskDueFilter | undefined,
  timeZone: string,
  now: Date = new Date(),
): Pick<TaskFilters, 'dueFrom' | 'dueTo' | 'dueNone'> {
  if (!due) return {};
  if (due === 'none') return { dueNone: true };
  const today = overdueCutoff(timeZone, now);
  if (due === 'overdue') return { dueTo: today };
  if (due === 'today') return { dueFrom: today, dueTo: new Date(today.getTime() + DAY_MS) };
  return { dueFrom: today, dueTo: new Date(today.getTime() + 7 * DAY_MS) };
}

/** `none` → null, an id → ObjectId, absent → leaves the filter unset. */
function idOrNone(value: string | undefined): mongoose.Types.ObjectId | null | undefined {
  if (value === 'none') return null;
  return value ? new mongoose.Types.ObjectId(value) : undefined;
}

/**
 * Parse GET /groups/:groupId/tasks query params into service filters. Sends a 400/401 and
 * returns null when they're invalid.
 */
export async function parseListFilters(req: Request, res: Response): Promise<TaskFilters | null> {
  const authReq = req as AuthenticatedRequest;
  const groupId = req.params.groupId as string;

  const queryResult = taskQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    sendError(res, 400, validationMessage(queryResult.error), 'Invalid query params');
    return null;
  }

  const { assigneeId, epicId, parentTaskId, status, category, open, due, ...rest } = queryResult.data;
  const filters: TaskFilters = { ...rest };
  const parent = idOrNone(parentTaskId);
  if (parent !== undefined) filters.parentTaskId = parent;
  const epic = idOrNone(epicId);
  if (epic !== undefined) filters.epicId = epic;
  // Overdue only counts tasks that are still open (done/cancelled are never overdue).
  const statuses = resolveStatusFilter({ status, category, open: open || due === 'overdue' });
  if (statuses) {
    filters.statuses = statuses;
  }
  if (due) {
    const group =
      due === 'none' ? null : (authReq.group ?? (await groupService.findGroupById(new mongoose.Types.ObjectId(groupId))));
    Object.assign(filters, resolveDueFilter(due, resolveGroupTimezone(group?.timezone)));
  }
  if (assigneeId === 'me') {
    if (!authReq.user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return null;
    }
    filters.assigneeId = authReq.user._id as mongoose.Types.ObjectId;
  } else if (assigneeId === 'none') {
    filters.assigneeId = null;
  } else if (assigneeId) {
    filters.assigneeId = new mongoose.Types.ObjectId(assigneeId);
  }
  return filters;
}
