import type {
  ApiResponse,
  CreateTaskInput,
  ITask,
  ITaskActivity,
  TaskCounts,
  TaskFilters,
  TaskStatusCategory,
  UpdateTaskInput,
} from '@tbot/shared';
import { type QueryKey, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { getParentId, getProgress } from '@/lib/subtasks';

import { epicKeys } from './epics';
import { groupKeys } from './groups';
import { invalidateSubtaskViews, patchSubtaskLists, subtaskListSnapshots } from './subtasks';
import { applyTaskChange, findCachedTask, type TaskPage, type TaskPages } from './task-cache';

/** Tasks per page (list view, each board column). The API caps a page at 100. */
export const TASK_PAGE_SIZE = 20;

/**
 * Query params of GET /groups/:id/tasks. Shared `TaskFilters` doesn't have the
 * contract's `category` / `open` params yet, so they're added here.
 */
/** Kept as an alias so existing imports keep working; shared TaskFilters now carries category/open. */
export type ApiTaskFilters = TaskFilters;

export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  groupLists: (groupId: string) => [...taskKeys.lists(), groupId] as const,
  /** A paged list (or one board column when `filters.status` is set). `page` is never part of the key. */
  list: (groupId: string, filters?: ApiTaskFilters) => [...taskKeys.groupLists(groupId), filters ?? {}] as const,
  /** Per-status counts for the same filters (board headers). Under groupLists so list invalidation hits it. */
  counts: (groupId: string, filters?: ApiTaskFilters) =>
    [...taskKeys.groupLists(groupId), 'counts', filters ?? {}] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (taskId: string) => [...taskKeys.details(), taskId] as const,
  activity: (taskId: string) => [...taskKeys.all, 'activity', taskId] as const,
  stats: (groupId: string) => [...taskKeys.all, 'stats', groupId] as const,
};

/** Per-status counts + overdue (+ byCategory once the API adds it). */
export type TaskStats = Partial<Record<string, number>> & {
  overdue?: number;
  byCategory?: Record<TaskStatusCategory, number>;
};

function toParams(filters: ApiTaskFilters): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') params[key] = String(value);
  }
  return params;
}

/**
 * Paged GET /groups/:id/tasks — `fetchNextPage()` loads the next `TASK_PAGE_SIZE` tasks.
 * Used for the list view, the assignee board and (with `status`) each status-board column.
 */
export function useTaskPages(groupId: string, filters: ApiTaskFilters, options: { enabled?: boolean } = {}) {
  const { page: _page, ...keyFilters } = filters;
  return useInfiniteQuery<TaskPage, Error, TaskPages, QueryKey, number>({
    queryKey: taskKeys.list(groupId, keyFilters),
    queryFn: async ({ pageParam, signal }) => {
      const params = toParams({ limit: TASK_PAGE_SIZE, ...keyFilters, page: pageParam });
      const { data } = await apiClient.get<TaskPage>(`/groups/${groupId}/tasks`, { params, signal });
      return data;
    },
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const { page, limit, total, hasMore } = last.meta;
      return (hasMore ?? page * limit < total) ? page + 1 : undefined;
    },
    enabled: !!groupId && (options.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

/** Per-status counts of the tasks matching `filters` (page/limit/sort ignored). */
export function useTaskCounts(groupId: string, filters: ApiTaskFilters, options: { enabled?: boolean } = {}) {
  const { page: _page, limit: _limit, sort: _sort, dir: _dir, ...keyFilters } = filters;
  return useQuery({
    queryKey: taskKeys.counts(groupId, keyFilters),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<ApiResponse<TaskCounts>>(`/groups/${groupId}/tasks/counts`, {
        params: toParams(keyFilters),
        signal,
      });
      return data.data;
    },
    enabled: !!groupId && (options.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<ITask>>(`/tasks/${taskId}`);
      return data.data;
    },
    enabled: !!taskId,
  });
}

export function useTaskActivity(taskId: string) {
  return useQuery({
    queryKey: taskKeys.activity(taskId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<ITaskActivity[]>>(`/tasks/${taskId}/activity`);
      return data.data;
    },
    enabled: !!taskId,
  });
}

export function useTaskStats(groupId: string) {
  return useQuery({
    queryKey: taskKeys.stats(groupId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<TaskStats>>(`/groups/${groupId}/stats`);
      return data.data;
    },
    enabled: !!groupId,
  });
}

function invalidateGroup(queryClient: ReturnType<typeof useQueryClient>, groupId: string) {
  queryClient.invalidateQueries({ queryKey: taskKeys.groupLists(groupId) });
  queryClient.invalidateQueries({ queryKey: taskKeys.stats(groupId) });
  queryClient.invalidateQueries({ queryKey: groupKeys.list() });
  // Epic progress counts follow task status / epic changes.
  queryClient.invalidateQueries({ queryKey: epicKeys.list(groupId) });
}

export function useCreateTask(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const { data } = await apiClient.post<ApiResponse<ITask>>(`/groups/${groupId}/tasks`, input);
      return data.data;
    },
    onSuccess: (task) => {
      // Show it in its column / the list right away; the refetch confirms.
      applyTaskChange(queryClient, groupId, null, task);
      invalidateGroup(queryClient, groupId);
      invalidateSubtaskViews(queryClient, groupId, [getParentId(task)]);
    },
  });
}

export interface UpdateTaskVariables {
  taskId: string;
  input: UpdateTaskInput;
  /** Fields to apply to cached copies immediately (e.g. a populated assignee object). */
  optimistic?: Partial<ITask>;
}

interface UpdateContext {
  snapshots: [QueryKey, unknown][];
  /** Parent before the change — its progress / subtask list may need a refetch. */
  previousParentId?: string | null;
}

/**
 * PATCH a task. Cached list/detail copies are updated optimistically and rolled back
 * if the request fails.
 */
export function useUpdateTask(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation<ITask, unknown, UpdateTaskVariables, UpdateContext>({
    mutationFn: async ({ taskId, input }) => {
      const { data } = await apiClient.patch<ApiResponse<ITask>>(`/tasks/${taskId}`, input);
      return data.data;
    },
    onMutate: async ({ taskId, optimistic }) => {
      const cached =
        findCachedTask(queryClient, groupId, taskId) ?? queryClient.getQueryData<ITask>(taskKeys.detail(taskId));
      const previousParentId = cached ? getParentId(cached) : null;
      if (!optimistic) return { snapshots: [], previousParentId };
      await Promise.all([
        queryClient.cancelQueries({ queryKey: taskKeys.groupLists(groupId) }),
        queryClient.cancelQueries({ queryKey: taskKeys.detail(taskId) }),
      ]);
      const snapshots: [QueryKey, unknown][] = [
        ...queryClient.getQueriesData({ queryKey: taskKeys.groupLists(groupId) }),
        [taskKeys.detail(taskId), queryClient.getQueryData(taskKeys.detail(taskId))],
        ...subtaskListSnapshots(queryClient),
      ];
      // Patch every cached copy; a status change moves the card between board columns' pages.
      const before =
        findCachedTask(queryClient, groupId, taskId) ?? queryClient.getQueryData<ITask>(taskKeys.detail(taskId));
      if (before) applyTaskChange(queryClient, groupId, before, { ...before, ...optimistic });
      queryClient.setQueryData<ITask>(taskKeys.detail(taskId), (old) => (old ? { ...old, ...optimistic } : old));
      patchSubtaskLists(queryClient, taskId, optimistic);
      return { snapshots, previousParentId };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task._id), task);
    },
    onSettled: (data, _err, { taskId }, context) => {
      invalidateGroup(queryClient, groupId);
      queryClient.invalidateQueries({ queryKey: taskKeys.activity(taskId) });
      invalidateSubtaskViews(queryClient, groupId, [context?.previousParentId, data ? getParentId(data) : null]);
    },
  });
}

export function useDeleteTask(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      await apiClient.delete(`/tasks/${taskId}`);
      return taskId;
    },
    onSuccess: (taskId) => {
      const before =
        findCachedTask(queryClient, groupId, taskId) ?? queryClient.getQueryData<ITask>(taskKeys.detail(taskId));
      if (before) applyTaskChange(queryClient, groupId, before, null);
      queryClient.removeQueries({ queryKey: taskKeys.detail(taskId) });
      invalidateGroup(queryClient, groupId);
      invalidateSubtaskViews(queryClient, groupId, [before ? getParentId(before) : null]);
      // A deleted parent's subtasks became regular tasks — any open detail of one must drop its "↳ #n".
      if (before && getProgress(before)) queryClient.invalidateQueries({ queryKey: taskKeys.details() });
    },
  });
}
