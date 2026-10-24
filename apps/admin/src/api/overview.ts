import type {
  AdminOverview,
  AdminRange,
  ApiResponse,
} from '@tbot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export const overviewKeys = {
  all: ['overview'] as const,
  range: (range: AdminRange) => [...overviewKeys.all, range] as const,
};

/** GET /overview?range= */
export function useOverview(range: AdminRange) {
  return useQuery({
    queryKey: overviewKeys.range(range),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminOverview>>('/overview', { params: { range } });
      return data.data;
    },
    placeholderData: keepPreviousData,
  });
}
