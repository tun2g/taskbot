import type {
  AdminAiOverrideInput,
  AdminAiOverrideResult,
  AdminRange,
  AdminUserDetail,
  AdminUserRow,
  ApiResponse,
  PaginatedResponse,
} from '@tbot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { UserSort } from '@/lib/labels';
import { toast } from '@/lib/toast';

import { useAdminMutation } from './mutation';

export interface UserListParams {
  /** Period of the numbers on each row (same as the person page). */
  range?: AdminRange;
  /** today | 7d | 30d — only people who used the bot in that window. */
  activeIn?: string;
  /** '1' = only people holding an active MCP token. */
  hasTokens?: string;
  q?: string;
  sort?: UserSort;
  page?: number;
  limit?: number;
}

export const userKeys = {
  all: ['users'] as const,
  list: (params: UserListParams) => [...userKeys.all, 'list', params] as const,
  detail: (id: string, range: AdminRange) => [...userKeys.all, 'detail', id, range] as const,
};

/** GET /users?q=&sort=&range=&page=&limit= */
export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<AdminUserRow>>('/users', { params });
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

/** GET /users/:id?range= */
export function useUser(id: string, range: AdminRange, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: userKeys.detail(id, range),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminUserDetail>>(`/users/${id}`, { params: { range } });
      return data.data;
    },
    placeholderData: keepPreviousData,
    enabled: (opts.enabled ?? true) && !!id,
  });
}

const AFTER_USER_CHANGE = [userKeys.all, ['audit'], ['mcp'], ['ai']];

/** "/audit-log?targetType=user&targetId=…" — where a change to this person is recorded. */
export const auditHref = (targetType: 'user' | 'group', id: string) => `/audit-log?targetType=${targetType}&targetId=${encodeURIComponent(id)}`;

/** PATCH /users/:id/ai → toast with a link to the audit entry. */
export function useSetUserAi() {
  return useAdminMutation({
    mutationFn: async (vars: { id: string } & AdminAiOverrideInput) => {
      const { id, ...body } = vars;
      const { data } = await apiClient.patch<ApiResponse<AdminAiOverrideResult> & { warnings?: string[] }>(`/users/${id}/ai`, body);
      return data;
    },
    onSuccess: (result, vars) => {
      const seconds = result?.data?.appliesWithinSeconds ?? 30;
      toast.success(`Saved — applies within ${seconds}s`, undefined, { label: 'See it in the audit log →', href: auditHref('user', vars.id) });
    },
    invalidate: AFTER_USER_CHANGE,
  });
}

/** POST /users/:id/revoke-tokens — every MCP token of this person stops working. */
export function useRevokeUserTokens() {
  return useAdminMutation({
    mutationFn: async (vars: { id: string; name: string }) => {
      const { data } = await apiClient.post<ApiResponse<{ revoked: number }> & { warnings?: string[] }>(
        `/users/${vars.id}/revoke-tokens`,
        {},
      );
      return data;
    },
    successMessage: (vars, result) => {
      const n = result?.data?.revoked;
      return typeof n === 'number'
        ? `Revoked ${n} MCP token${n === 1 ? '' : 's'} of ${vars.name}`
        : `Revoked every MCP token of ${vars.name}`;
    },
    invalidate: AFTER_USER_CHANGE,
  });
}
