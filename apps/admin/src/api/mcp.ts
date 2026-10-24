import type {
  AdminMcpOverview,
  AdminRange,
  ApiResponse,
} from '@tbot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface McpFilter {
  tool?: string;
  client?: string;
}

export const mcpKeys = {
  all: ['mcp'] as const,
  range: (range: AdminRange, filter: McpFilter = {}) => [...mcpKeys.all, range, filter] as const,
};

/** GET /mcp?range=&tool=&client= */
export function useMcpOverview(range: AdminRange, filter: McpFilter = {}) {
  return useQuery({
    queryKey: mcpKeys.range(range, filter),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminMcpOverview>>('/mcp', { params: { range, ...filter } });
      return data.data;
    },
    placeholderData: keepPreviousData,
  });
}
