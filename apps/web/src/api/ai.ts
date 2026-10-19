import type { AiChatRequest, AiChatResponse, AiUndoResponse, ApiResponse } from '@tbot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { groupKeys } from './groups';
import { taskKeys } from './tasks';

/** Refresh every task list / detail / activity / stats query so the board and detail update live. */
function invalidateTasks(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: taskKeys.all });
  queryClient.invalidateQueries({ queryKey: groupKeys.list() });
}

/** POST /groups/:groupId/ai — one "Ask AI" turn. */
export function useAiChat(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: AiChatRequest) => {
      const { data } = await apiClient.post<ApiResponse<AiChatResponse>>(`/groups/${groupId}/ai`, request);
      return data.data;
    },
    onSuccess: (response) => {
      if (response.kind === 'updated' || response.kind === 'created') invalidateTasks(queryClient);
    },
  });
}

/** POST /batches/:batchId/undo — removes the tasks an AI reply created. */
export function useUndoBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data } = await apiClient.post<ApiResponse<AiUndoResponse>>(`/batches/${batchId}/undo`);
      return data.data;
    },
    onSuccess: () => invalidateTasks(queryClient),
  });
}
