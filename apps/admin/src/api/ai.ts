import type {
  AdminAiCallRow,
  AdminAiUsage,
  AdminRange,
  AiCallStatus,
  AiFeature,
  ApiResponse,
  PaginatedResponse,
} from '@tbot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface AiUsageParams {
  range: AdminRange;
  groupBy: AdminAiUsage['groupBy'];
  groupId?: string;
  userId?: string;
}

export interface AiCallParams {
  range?: AdminRange;
  status?: AiCallStatus;
  feature?: AiFeature;
  groupId?: string;
  userId?: string;
  page?: number;
  limit?: number;
}

export const aiKeys = {
  all: ['ai'] as const,
  usage: (params: AiUsageParams) => [...aiKeys.all, 'usage', params] as const,
  calls: (params: AiCallParams) => [...aiKeys.all, 'calls', params] as const,
};

/** GET /ai/usage?range=&groupBy=&groupId=&userId= */
export function useAiUsage(params: AiUsageParams) {
  return useQuery({
    queryKey: aiKeys.usage(params),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminAiUsage>>('/ai/usage', { params });
      return data.data;
    },
    placeholderData: keepPreviousData,
  });
}

/** GET /ai/calls?status=&feature=&groupId=&userId=&page=&limit= (+ range, see docs/admin.md). */
export function useAiCalls(params: AiCallParams) {
  return useQuery({
    queryKey: aiKeys.calls(params),
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<AdminAiCallRow>>('/ai/calls', { params });
      return data;
    },
    placeholderData: keepPreviousData,
  });
}
