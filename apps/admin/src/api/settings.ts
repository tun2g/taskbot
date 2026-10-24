import type {
  AdminAiSettings,
  ApiResponse,
} from '@tbot/shared';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { aiKeys } from './ai';
import { auditKeys } from './audit';
import { useAdminMutation } from './mutation';
import { overviewKeys } from './overview';

export const settingsKeys = { ai: ['settings', 'ai'] as const };

/** GET /settings/ai */
export function useAiSettings() {
  return useQuery({
    queryKey: settingsKeys.ai,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminAiSettings>>('/settings/ai');
      return data.data;
    },
  });
}

export type AiSettingsInput = Omit<AdminAiSettings, 'defaults'>;

/** PUT /settings/ai — `pricing` holds only your overrides; built-in prices are in `defaults`. */
export function useSaveAiSettings() {
  return useAdminMutation({
    mutationFn: async (input: AiSettingsInput) => {
      const { data } = await apiClient.put<ApiResponse<AdminAiSettings> & { warnings?: string[] }>(
        '/settings/ai',
        input,
      );
      return data;
    },
    successMessage: 'AI settings saved — they apply within 30 seconds',
    invalidate: [settingsKeys.ai, overviewKeys.all, auditKeys.all, aiKeys.all],
  });
}
