import type { AdminLoginLinkResponse, AdminSession, ApiResponse } from '@tbot/shared';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export const authKeys = {
  session: ['auth', 'session'] as const,
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

/** POST /auth/exchange { code } — trades the link's code for the session cookie. */
export async function exchangeLoginCode(code: string): Promise<AdminSession> {
  const { data } = await apiClient.post<ApiResponse<AdminSession>>('/auth/exchange', { code });
  return data.data;
}

/** POST /auth/logout (this browser) or /auth/logout-all (every session). */
export async function logout(everywhere: boolean): Promise<void> {
  await apiClient.post(everywhere ? '/auth/logout-all' : '/auth/logout', {});
}
