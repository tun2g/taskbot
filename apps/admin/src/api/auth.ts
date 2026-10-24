import type {
  AdminLoginLinkResponse,
  AdminLoginLinkStatus,
  AdminSession,
  AdminSessionRow,
  ApiResponse,
} from '@tbot/shared';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { auditKeys } from './audit';
import { useAdminMutation } from './mutation';

export const authKeys = {
  session: ['auth', 'session'] as const,
  sessions: ['auth', 'sessions'] as const,
  linkStatus: (requestId: string | undefined) => ['auth', 'link-status', requestId] as const,
};

/** GET /auth/me — who is logged in (401 when nobody). */
export const sessionQuery = queryOptions({
  queryKey: authKeys.session,
  queryFn: async () => {
    const { data } = await apiClient.get<ApiResponse<AdminSession>>('/auth/me');
    return data.data;
  },
  staleTime: 5 * 60 * 1000,
  retry: false,
});

export function useSession() {
  return useQuery(sessionQuery);
}

/** POST /auth/request-link — the bot DMs the owner a one-time login link. */
export function useRequestLoginLink() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<ApiResponse<AdminLoginLinkResponse>>('/auth/request-link', {});
      return data.data;
    },
  });
}

/**
 * GET /auth/link-status — polled by the waiting login page only to learn that the link was opened (maybe in
 * another browser). It never signs this browser in.
 */
export function useLoginLinkStatus(requestId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: authKeys.linkStatus(requestId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminLoginLinkStatus>>('/auth/link-status', {
        params: { requestId },
      });
      return data.data.status;
    },
    enabled: enabled && !!requestId,
    refetchInterval: (q) => (q.state.data === 'unused' || q.state.data === undefined ? 3000 : false),
  });
}

/** POST /auth/exchange { code } — trades the link's code for the session cookie. */
export async function exchangeLoginCode(code: string): Promise<AdminSession> {
  const { data } = await apiClient.post<ApiResponse<AdminSession>>('/auth/exchange', { code });
  return data.data;
}

/** POST /auth/logout (this browser) or /auth/logout-all (every session). */
export async function logout(everywhere: boolean): Promise<void> {
  await apiClient.post(everywhere ? '/auth/logout-all' : '/auth/logout', {});
}

/** GET /auth/sessions — every browser signed in to the admin app. */
export function useActiveSessions(enabled: boolean) {
  return useQuery({
    queryKey: authKeys.sessions,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminSessionRow[]>>('/auth/sessions');
      return data.data;
    },
    enabled,
  });
}

/** POST /auth/sessions/:id/revoke — sign out one other browser. */
export function useRevokeSession() {
  return useAdminMutation({
    mutationFn: async (session: AdminSessionRow) => {
      const { data } = await apiClient.post<ApiResponse<{ ok: true }>>(`/auth/sessions/${session.id}/revoke`, {});
      return data;
    },
    successMessage: (s) => `${s.browser} is signed out`,
    invalidate: [authKeys.sessions, auditKeys.all],
  });
}
