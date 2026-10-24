import type {
  AdminAuditEntry,
  PaginatedResponse,
} from '@tbot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { AuditTarget } from '@/lib/search';

export interface AuditParams {
  targetType?: AuditTarget;
  targetId?: string;
  page?: number;
  limit?: number;
}

export const auditKeys = {
  all: ['audit'] as const,
  list: (params: AuditParams) => [...auditKeys.all, params] as const,
};

/** GET /audit-log?page=&limit=&targetType=&targetId= */
export function useAuditLog(params: AuditParams) {
  return useQuery({
    queryKey: auditKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<AdminAuditEntry>>('/audit-log', { params });
      return data;
    },
    placeholderData: keepPreviousData,
  });
}
