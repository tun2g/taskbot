import { isObjectId } from '@/lib/epics';

/** URL search params of /$groupId/tasks/$taskId. */
export interface TaskSearch {
  /** The task this one was opened from (a parent → its subtask): "back" returns there instead of the board. */
  from?: string;
}

export function validateTaskSearch(search: Record<string, unknown>): TaskSearch {
  return { from: isObjectId(search.from) ? search.from : undefined };
}
