import type {
  ApiResponse,
  CreateTaskInput,
  ITask,
  ITaskActivity,
  PaginatedResponse,
  TaskFilters,
  TaskStatusCategory,
  UpdateTaskInput,
} from '@tbot/shared';
import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { groupKeys } from './groups';

export const BOARD_LIMIT = 500;

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
  list: (groupId: string, filters?: ApiTaskFilters) => [...taskKeys.groupLists(groupId), filters ?? {}] as const,
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

export function useTasksList(groupId: string, filters: ApiTaskFilters) {
  return useQuery({
    queryKey: taskKeys.list(groupId, filters),
    queryFn: async ({ signal }) => {
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== '') params[key] = String(value);
      }
      const { data } = await apiClient.get<PaginatedResponse<ITask>>(`/groups/${groupId}/tasks`, { params, signal });
      return data;
    },
    enabled: !!groupId,
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
}

export function useCreateTask(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const { data } = await apiClient.post<ApiResponse<ITask>>(`/groups/${groupId}/tasks`, input);
      return data.data;
    },
    onSuccess: () => invalidateGroup(queryClient, groupId),
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
      if (!optimistic) return { snapshots: [] };
      await Promise.all([
        queryClient.cancelQueries({ queryKey: taskKeys.groupLists(groupId) }),
        queryClient.cancelQueries({ queryKey: taskKeys.detail(taskId) }),
      ]);
      const snapshots: [QueryKey, unknown][] = [
        ...queryClient.getQueriesData({ queryKey: taskKeys.groupLists(groupId) }),
        [taskKeys.detail(taskId), queryClient.getQueryData(taskKeys.detail(taskId))],
      ];
      queryClient.setQueriesData<PaginatedResponse<ITask>>({ queryKey: taskKeys.groupLists(groupId) }, (old) =>
        old ? { ...old, data: old.data.map((t) => (t._id === taskId ? { ...t, ...optimistic } : t)) } : old,
      );
      queryClient.setQueryData<ITask>(taskKeys.detail(taskId), (old) => (old ? { ...old, ...optimistic } : old));
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task._id), task);
    },
    onSettled: (_data, _err, { taskId }) => {
      invalidateGroup(queryClient, groupId);
      queryClient.invalidateQueries({ queryKey: taskKeys.activity(taskId) });
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
      queryClient.removeQueries({ queryKey: taskKeys.detail(taskId) });
      invalidateGroup(queryClient, groupId);
    },
  });
}
