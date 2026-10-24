/** Aggregation expressions shared by the stats queries. */
import { TASK_STATUS_CATEGORY, TaskStatusCategory } from '@tbot/shared';
import { Types } from 'mongoose';

/**
 * Refusals (a daily limit, or AI turned off by the owner) are recorded as ai_calls but never reached the
 * provider: they are not "calls" or "failures" — the same rule as the overview and the bot's stats_daily.
 */
const REFUSALS = ['quota', 'disabled'];
export const PROVIDER_CALL = { $cond: [{ $in: ['$status', REFUSALS] }, 0, 1] };
export const FAILED_CALL = { $cond: [{ $in: ['$status', ['failed', 'invalid']] }, 1, 0] };
export const REFUSED_CALL = { $cond: [{ $in: ['$status', REFUSALS] }, 1, 0] };
/** A provider call whose model had no price. */
export const UNPRICED_CALL = { $cond: [{ $or: ['$priced', { $in: ['$status', REFUSALS] }] }, 0, 1] };

export const DAY_EXPR = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'UTC' } });

/** Task statuses that count as closed (done / cancelled). */
export const CLOSED_STATUSES = Object.entries(TASK_STATUS_CATEGORY)
  .filter(([, c]) => c === TaskStatusCategory.DONE)
  .map(([s]) => s);

export interface LiveFilter {
  groupId?: Types.ObjectId;
  groupIds?: Types.ObjectId[];
}

export function groupMatch(filter: LiveFilter, field = 'groupId'): Record<string, unknown> {
  if (filter.groupId) return { [field]: filter.groupId };
  if (filter.groupIds) return { [field]: { $in: filter.groupIds } };
  return {};
}

/** Map key of an aggregation `_id` (null / missing → ""). */
export const idKey = (id: unknown) => (id === null || id === undefined ? '' : String(id));
