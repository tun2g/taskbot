import { type QueryClient, type QueryKey, useQuery } from '@tanstack/react-query';
import type { ApiResponse, ITask, PaginatedResponse } from '@tbot/shared';
import { SUBTASKS_MAX } from '@tbot/shared';

import { apiClient } from '@/lib/api-client';
import { getProgress, subtaskCount } from '@/lib/subtasks';

// Subtask reads and the cache upkeep that keeps a parent's "2/5 done" and its subtask list in step.
// Keys sit under ['tasks'] (so a full task invalidation hits them) but outside the paged list keys.

export const subtaskKeys = {
  all: ['tasks', 'subtasks'] as const,
  list: (parentTaskId: string) => [...subtaskKeys.all, parentTaskId] as const,
  /** Tasks that can become a parent (top-level, newest first). */
  parentCandidates: (groupId: string) => ['tasks', 'parent-candidates', groupId] as const,
};

/** A parent's subtasks, oldest first. */
export function useSubtasks(parentTaskId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: subtaskKeys.list(parentTaskId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<ApiResponse<ITask[]>>(`/tasks/${parentTaskId}/subtasks`, { signal });
      return data.data;
    },
    enabled: !!parentTaskId && (options.enabled ?? true),
  });
}

/** Most candidates one parent-picker search returns (newest first); typing narrows it on the server. */
const PARENT_CANDIDATES_LIMIT = 30;

/**
 * Tasks that can take a subtask: open, top-level (not subtasks themselves), matching `search` (title or #number)
 * on the server. Enabled only while the picker is open.
 */
export function useParentCandidates(groupId: string, search: string, options: { enabled?: boolean } = {}) {
  const q = search.trim();
  return useQuery({
    queryKey: [...subtaskKeys.parentCandidates(groupId), q],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<PaginatedResponse<ITask>>(`/groups/${groupId}/tasks`, {
        params: { parentTaskId: 'none', open: true, limit: PARENT_CANDIDATES_LIMIT, ...(q ? { search: q } : {}) },
        signal,
      });
      return data.data;
    },
    enabled: !!groupId && (options.enabled ?? true),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** True when the parent can't take another subtask (cancelled ones count toward the cap). */
export const isParentFull = (task: Pick<ITask, 'subtaskProgress'>) => subtaskCount(getProgress(task)) >= SUBTASKS_MAX;

/** Snapshots of every cached subtask list (for optimistic rollbacks). */
export function subtaskListSnapshots(queryClient: QueryClient): [QueryKey, unknown][] {
  return queryClient.getQueriesData({ queryKey: subtaskKeys.all });
}

/** Applies a change to the task wherever it is cached as a subtask row. */
export function patchSubtaskLists(queryClient: QueryClient, taskId: string, patch: Partial<ITask>) {
  queryClient.setQueriesData<ITask[]>({ queryKey: subtaskKeys.all }, (rows) =>
    rows?.some((t) => t._id === taskId) ? rows.map((t) => (t._id === taskId ? { ...t, ...patch } : t)) : rows,
  );
}

/**
 * After a create / update / delete: refetch the open subtask lists, the parent candidates and the
 * given parents' details (their progress moved). Only mounted queries actually refetch.
 */
export function invalidateSubtaskViews(
  queryClient: QueryClient,
  groupId: string,
  parentIds: (string | null | undefined)[],
) {
  queryClient.invalidateQueries({ queryKey: subtaskKeys.all });
  queryClient.invalidateQueries({ queryKey: subtaskKeys.parentCandidates(groupId) });
  for (const id of new Set(parentIds.filter((p): p is string => !!p))) {
    queryClient.invalidateQueries({ queryKey: ['tasks', 'detail', id] });
  }
}
