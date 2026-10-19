import type { ApiResponse, IGroup, IGroupSummary, IUser } from '@tbot/shared';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export const groupKeys = {
  all: ['groups'] as const,
  list: () => [...groupKeys.all, 'list'] as const,
  detail: (groupId: string) => [...groupKeys.all, 'detail', groupId] as const,
  members: (groupId: string) => [...groupKeys.all, 'members', groupId] as const,
};

export function useGroupsList() {
  return useQuery({
    queryKey: groupKeys.list(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<IGroupSummary[]>>('/groups');
      return data.data;
    },
  });
}

export function useGroup(groupId: string) {
  return useQuery({
    queryKey: groupKeys.detail(groupId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<IGroup>>(`/groups/${groupId}`);
      return data.data;
    },
    enabled: !!groupId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useGroupMembers(groupId: string) {
  return useQuery({
    queryKey: groupKeys.members(groupId),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<IUser[]>>(`/groups/${groupId}/members`);
      return data.data;
    },
    enabled: !!groupId,
    staleTime: 1000 * 60 * 5,
  });
}
