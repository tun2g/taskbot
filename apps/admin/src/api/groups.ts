import type {
  AdminAiOverrideInput,
  AdminGroupActionInput,
  AdminGroupDeletePreview,
  AdminGroupDetail,
  AdminGroupRow,
  AdminRange,
  ApiResponse,
  GroupStatus,
  PaginatedResponse,
} from '@tbot/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { GroupSort } from '@/lib/labels';

import { useAdminMutation } from './mutation';

export interface GroupListParams {
  status?: GroupStatus;
  /** Only groups with activity in this period; rows then carry `inPeriod`. */
  activeIn?: AdminRange;
  q?: string;
  sort?: GroupSort;
  page?: number;
  limit?: number;
}

export const groupKeys = {
  all: ['groups'] as const,
  list: (params: GroupListParams) => [...groupKeys.all, 'list', params] as const,
  detail: (id: string, range: AdminRange) => [...groupKeys.all, 'detail', id, range] as const,
  deletePreview: (id: string) => [...groupKeys.all, 'delete-preview', id] as const,
};

/** GET /groups?status=&q=&sort=&page=&limit= */
export function useGroups(params: GroupListParams, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: groupKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<AdminGroupRow>>('/groups', { params });
      return data;
    },
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

/** Groups waiting for approval — the sidebar badge. */
export function usePendingCount() {
  const query = useGroups({ status: 'pending' as GroupStatus, limit: 1 });
  return query.data?.meta.total ?? 0;
}

/** GET /groups/:id?range= */
export function useGroup(id: string, range: AdminRange, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: groupKeys.detail(id, range),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminGroupDetail>>(`/groups/${id}`, { params: { range } });
      return data.data;
    },
    placeholderData: keepPreviousData,
    enabled: (opts.enabled ?? true) && !!id,
  });
}

/** GET /groups/:id/delete-preview — counts for the delete confirmation. */
export function useGroupDeletePreview(id: string, enabled: boolean) {
  return useQuery({
    queryKey: groupKeys.deletePreview(id),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminGroupDeletePreview>>(`/groups/${id}/delete-preview`);
      return data.data;
    },
    enabled: enabled && !!id,
    staleTime: 0,
  });
}

const AFTER_GROUP_CHANGE = [groupKeys.all, ['overview'], ['audit'], ['users']];

export type GroupAction = 'approve' | 'reject' | 'suspend' | 'unsuspend' | 'leave';

const ACTION_DONE: Record<GroupAction, string> = {
  approve: 'approved',
  reject: 'rejected',
  suspend: 'suspended',
  unsuspend: 'is active again',
  leave: '— the bot left the chat',
};

/** POST /groups/:id/{approve|reject|suspend|unsuspend|leave} */
export function useGroupAction() {
  return useAdminMutation({
    mutationFn: async (vars: { group: { id: string; name: string }; action: GroupAction } & AdminGroupActionInput) => {
      const { group, action, ...body } = vars;
      const { data } = await apiClient.post<ApiResponse<unknown> & { warnings?: string[] }>(
        `/groups/${group.id}/${action}`,
        body,
      );
      return data;
    },
    successMessage: (vars) => `“${vars.group.name}” ${ACTION_DONE[vars.action]}`,
    invalidate: AFTER_GROUP_CHANGE,
  });
}

/** DELETE /groups/:id { confirmName } */
export function useDeleteGroup(onDeleted?: () => void) {
  return useAdminMutation({
    mutationFn: async (vars: { group: { id: string; name: string }; confirmName: string }) => {
      const { data } = await apiClient.delete<{ warnings?: string[] }>(`/groups/${vars.group.id}`, {
        data: { confirmName: vars.confirmName },
      });
      return data ?? {};
    },
    successMessage: (vars) => `“${vars.group.name}” was deleted`,
    invalidate: AFTER_GROUP_CHANGE,
    onSuccess: () => onDeleted?.(),
  });
}

/** PATCH /groups/:id/ai */
export function useSetGroupAi() {
  return useAdminMutation({
    mutationFn: async (vars: { id: string } & AdminAiOverrideInput) => {
      const { id, ...body } = vars;
      const { data } = await apiClient.patch<ApiResponse<unknown> & { warnings?: string[] }>(`/groups/${id}/ai`, body);
      return data;
    },
    successMessage: 'AI settings saved — they apply within 30 seconds',
    invalidate: AFTER_GROUP_CHANGE,
  });
}
