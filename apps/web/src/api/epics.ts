import type { ApiResponse, CreateEpicInput, DeleteEpicResult, EpicWithProgress, UpdateEpicInput } from '@tbot/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { forgetEpicInBoardSearch } from '@/pages/tasks/board-search';

import { taskKeys } from './tasks';

export const epicKeys = {
  all: ['epics'] as const,
  lists: () => [...epicKeys.all, 'list'] as const,
  list: (groupId: string) => [...epicKeys.lists(), groupId] as const,
};

/** Every epic of the group with its task counts (progress). */
export function useEpics(groupId: string) {
  return useQuery({
    queryKey: epicKeys.list(groupId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<EpicWithProgress[]>>(`/groups/${groupId}/epics`);
      return data.data;
    },
    enabled: !!groupId,
    staleTime: 1000 * 30,
  });
}

/** Tasks embed `{ _id, title, color, status }` of their epic, so renames / deletes must refetch them. */
function invalidateTasksOf(queryClient: QueryClient, groupId: string) {
  queryClient.invalidateQueries({ queryKey: taskKeys.groupLists(groupId) });
  queryClient.invalidateQueries({ queryKey: taskKeys.details() });
}

export function useCreateEpic(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateEpicInput) => {
      const { data } = await apiClient.post<ApiResponse<EpicWithProgress>>(`/groups/${groupId}/epics`, input);
      return data.data;
    },
    onSuccess: (epic, input) => {
      // Show it right away — pickers select it immediately.
      queryClient.setQueryData<EpicWithProgress[]>(epicKeys.list(groupId), (old) =>
        old && !old.some((e) => e._id === epic._id)
          ? [...old, { ...epic, progress: epic.progress ?? { total: 0, done: 0, inProgress: 0, cancelled: 0 } }]
          : old,
      );
      queryClient.invalidateQueries({ queryKey: epicKeys.list(groupId) });
      // Undo of a delete put tasks back into it.
      if (input.taskIds?.length) invalidateTasksOf(queryClient, groupId);
    },
  });
}

export interface UpdateEpicVariables {
  epicId: string;
  input: UpdateEpicInput;
}

/** PATCH an epic; the cached list is updated optimistically and rolled back on error. */
export function useUpdateEpic(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation<EpicWithProgress, unknown, UpdateEpicVariables, { previous?: EpicWithProgress[] }>({
    mutationFn: async ({ epicId, input }) => {
      const { data } = await apiClient.patch<ApiResponse<EpicWithProgress>>(`/epics/${epicId}`, input);
      return data.data;
    },
    onMutate: async ({ epicId, input }) => {
      await queryClient.cancelQueries({ queryKey: epicKeys.list(groupId) });
      const previous = queryClient.getQueryData<EpicWithProgress[]>(epicKeys.list(groupId));
      queryClient.setQueryData<EpicWithProgress[]>(epicKeys.list(groupId), (old) =>
        old?.map((e) => (e._id === epicId ? ({ ...e, ...input } as EpicWithProgress) : e)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(epicKeys.list(groupId), context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: epicKeys.list(groupId) });
      invalidateTasksOf(queryClient, groupId);
    },
  });
}

/** DELETE an epic. Its tasks stay — they just lose the epic. `taskIds` lets the caller offer Undo. */
export function useDeleteEpic(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (epicId: string) => {
      const { data } = await apiClient.delete<ApiResponse<DeleteEpicResult>>(`/epics/${epicId}`);
      const taskIds = data?.data?.taskIds ?? [];
      return { epicId, taskIds, tasksUnlinked: data?.data?.tasksUnlinked ?? taskIds.length };
    },
    onSuccess: ({ epicId }) => {
      forgetEpicInBoardSearch(groupId, epicId);
      queryClient.setQueryData<EpicWithProgress[]>(epicKeys.list(groupId), (old) =>
        old?.filter((e) => e._id !== epicId),
      );
      queryClient.invalidateQueries({ queryKey: epicKeys.list(groupId) });
      invalidateTasksOf(queryClient, groupId);
    },
  });
}
