import type {
  AdminJobFailures,
  AdminRunJobInput,
  AdminRunJobResult,
  AdminSystemStatus,
  ApiResponse,
} from '@tbot/shared';
import { backgroundJobInfo } from '@tbot/shared';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { auditKeys } from './audit';
import { useAdminMutation } from './mutation';

export const systemKeys = {
  all: ['system'] as const,
  failures: (job: { name: string; cron: string | null } | null) => [...systemKeys.all, 'failures', job] as const,
};

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

/** GET /system/jobs/failures?name=&cron= — the failed runs behind a "Failures" number (null job = every job). */
export function useJobFailures(job: { name: string; cron: string | null } | null, enabled: boolean) {
  return useQuery({
    queryKey: systemKeys.failures(job),
    queryFn: async () => {
      const params = job ? { name: job.name, ...(job.cron ? { cron: job.cron } : {}) } : {};
      const { data } = await apiClient.get<ApiResponse<AdminJobFailures>>('/system/jobs/failures', { params });
      return data.data;
    },
    enabled,
  });
}

/** POST /system/jobs/run — one run of a scheduled job now. */
export function useRunJob() {
  return useAdminMutation({
    mutationFn: async (input: AdminRunJobInput) => {
      const { data } = await apiClient.post<ApiResponse<AdminRunJobResult>>('/system/jobs/run', input);
      return data;
    },
    successMessage: (input) =>
      `“${backgroundJobInfo(input.name, input.cron).label}” started — the result shows here within a minute`,
    invalidate: [systemKeys.all, auditKeys.all],
  });
}
