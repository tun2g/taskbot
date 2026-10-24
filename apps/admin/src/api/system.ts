import type {
  AdminSystemStatus,
  ApiResponse,
} from '@tbot/shared';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export const systemKeys = { all: ['system'] as const };

/** GET /system — refreshed every 30 s while the page is open. */
export function useSystemStatus() {
  return useQuery({
    queryKey: systemKeys.all,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminSystemStatus>>('/system');
      return data.data;
    },
    refetchInterval: 30_000,
  });
}
