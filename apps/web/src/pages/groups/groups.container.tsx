import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { useGroupsList } from '@/api/groups';
import { getErrorMessage } from '@/lib/api-client';
import { clearToken } from '@/lib/auth';
import { isInTelegram } from '@/lib/telegram';

import { GroupsContent } from './groups.content';

export function GroupsContainer() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const groups = useGroupsList();

  const handleSignOut = () => {
    clearToken();
    queryClient.clear();
    navigate({ to: '/login', search: { redirect: undefined } });
  };

  return (
    <GroupsContent
      groups={groups.data ?? []}
      isLoading={groups.isLoading}
      error={groups.isError ? getErrorMessage(groups.error) : null}
      onRetry={() => groups.refetch()}
      isRetrying={groups.isFetching}
      onOpenGroup={(groupId) => navigate({ to: '/$groupId/tasks', params: { groupId } })}
      onSignOut={isInTelegram() ? undefined : handleSignOut}
    />
  );
}
