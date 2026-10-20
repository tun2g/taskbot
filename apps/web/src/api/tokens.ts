import type {
  ApiResponse,
  CreateApiTokenInput,
  CreateApiTokenResponse,
  IApiToken,
  McpInfoResponse as McpInfo,
} from '@tbot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export type { CreateApiTokenInput, CreateApiTokenResponse, IApiToken };

/** Most active tokens a user may hold; the server answers 409 beyond it. */
export const MAX_API_TOKENS = 10;

export const tokenKeys = {
  all: ['me', 'tokens'] as const,
  mcpInfo: ['mcp-info'] as const,
};

/** GET /me/tokens — the signed-in user's active tokens. */
export function useApiTokens() {
  return useQuery({
    queryKey: tokenKeys.all,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<IApiToken[]>>('/me/tokens');
      return data.data;
    },
    staleTime: 1000 * 30,
  });
}

/** POST /me/tokens — creates a token; the response carries the one-time secret. */
export function useCreateApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateApiTokenInput) => {
      const { data } = await apiClient.post<ApiResponse<CreateApiTokenResponse>>('/me/tokens', input);
      return data.data;
    },
    onSuccess: ({ token }) => {
      queryClient.setQueryData<IApiToken[]>(tokenKeys.all, (old) =>
        old && !old.some((t) => t._id === token._id) ? [token, ...old] : old,
      );
      queryClient.invalidateQueries({ queryKey: tokenKeys.all });
    },
  });
}

/** DELETE /me/tokens/:id — revokes immediately; removed from the cached list on success. */
export function useRevokeApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tokenId: string) => {
      const { data } = await apiClient.delete<ApiResponse<{ revoked: true }>>(`/me/tokens/${tokenId}`);
      return data.data;
    },
    onSuccess: (_res, tokenId) => {
      queryClient.setQueryData<IApiToken[]>(tokenKeys.all, (old) => old?.filter((t) => t._id !== tokenId));
      queryClient.invalidateQueries({ queryKey: tokenKeys.all });
    },
  });
}

/** GET /mcp-info — the MCP server URL to paste into Claude Code / Cursor. */
export function useMcpInfo() {
  return useQuery({
    queryKey: tokenKeys.mcpInfo,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<McpInfo>>('/mcp-info');
      return data.data;
    },
    staleTime: Infinity,
  });
}
