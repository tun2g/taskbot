import type { ApiResponse, AuthLoginResponse, IUser, TelegramLoginPayload } from '@tbot/shared';
import { useMutation, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export function useTelegramLogin() {
  return useMutation({
    mutationFn: async (payload: TelegramLoginPayload) => {
      const { data } = await apiClient.post<ApiResponse<AuthLoginResponse>>('/auth/telegram-login', payload);
      return data.data;
    },
  });
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<IUser>>('/me');
      return data.data;
    },
    staleTime: 1000 * 60 * 10,
  });
}
