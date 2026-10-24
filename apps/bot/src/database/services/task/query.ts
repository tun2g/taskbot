import { TASK_STATUS_ORDER } from '@tbot/shared';
import mongoose from 'mongoose';
import { TaskFilters } from 'src/database/services/task/types';

/** The Mongo match for a group's task filters (shared by the list and the per-status counts). */
export function buildTaskQuery(groupId: mongoose.Types.ObjectId, filters: TaskFilters = {}): Record<string, unknown> {
  const query: Record<string, unknown> = { groupId };

  if (filters.status && filters.statuses) {
    query.status = filters.statuses.includes(filters.status) ? filters.status : { $in: [] };
  } else if (filters.status) {
    query.status = filters.status;
  } else if (filters.statuses) {
    query.status = { $in: filters.statuses };
  }
  if (filters.type) query.type = filters.type;
  if (filters.assigneeId !== undefined) query.assigneeId = filters.assigneeId;
  if (filters.priority) query.priority = filters.priority;
  if (filters.epicId !== undefined) query.epicId = filters.epicId;
  if (filters.parentTaskId !== undefined) query.parentTaskId = filters.parentTaskId;
  if (filters.dueNone) {
    query.dueDate = null;
  } else if (filters.dueFrom || filters.dueTo) {
    const range: Record<string, Date | null> = { $ne: null };
    if (filters.dueFrom) range.$gte = filters.dueFrom;
    if (filters.dueTo) range.$lt = filters.dueTo;
    query.dueDate = range;
  }
  if (filters.search) {
    const search = filters.search.trim();
    const numberMatch = search.match(/^#?(\d+)$/);
    const pattern = { $regex: escapeRegex(search), $options: 'i' };
    query.$or = [
      { title: pattern },
      { description: pattern },
      ...(numberMatch ? [{ taskNumber: parseInt(numberMatch[1], 10) }] : []),
    ];
  }
  return query;
}

/** Every status key, each 0. */
export function emptyStatusCounts(): Record<string, number> {
  return Object.fromEntries(TASK_STATUS_ORDER.map((status) => [status, 0]));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
