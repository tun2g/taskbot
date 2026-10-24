import type {
  AdminMcpOverview,
  AdminMcpTokenFilter,
  AdminMcpTokenRow,
  AdminRange,
  AdminTokenRevokeResult,
  ApiResponse,
  PaginatedResponse,
} from '@tbot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { personName } from '@/lib/format';

import { useAdminMutation } from './mutation';

export interface McpFilter {
  tool?: string;
  client?: string;
}

export interface McpTokenParams {
  status: AdminMcpTokenFilter;
  userId?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export const mcpKeys = {
  all: ['mcp'] as const,
  range: (range: AdminRange, filter: McpFilter = {}) => [...mcpKeys.all, range, filter] as const,
  tokens: (params: McpTokenParams) => [...mcpKeys.all, 'tokens', params] as const,
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

/** GET /mcp/tokens?status=&userId=&q=&page=&limit= */
export function useMcpTokens(params: McpTokenParams, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: mcpKeys.tokens(params),
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<AdminMcpTokenRow>>('/mcp/tokens', { params });
      return data;
    },
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

/** POST /tokens/:id/revoke — only this token stops working. */
export function useRevokeToken() {
  return useAdminMutation({
    mutationFn: async (token: AdminMcpTokenRow) => {
      const { data } = await apiClient.post<ApiResponse<AdminTokenRevokeResult>>(`/tokens/${token.id}/revoke`, {});
      return data;
    },
    successMessage: (token) => `Revoked “${token.name}” of ${personName(token.person)} — their other tokens keep working`,
    invalidate: [mcpKeys.all, ['users'], ['audit']],
  });
}
