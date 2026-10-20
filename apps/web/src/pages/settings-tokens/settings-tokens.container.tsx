import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { useGroupsList } from '@/api/groups';
import {
  type CreateApiTokenInput,
  type CreateApiTokenResponse,
  type IApiToken,
  useApiTokens,
  useCreateApiToken,
  useMcpInfo,
  useRevokeApiToken,
} from '@/api/tokens';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';

import { SettingsTokensContent } from './settings-tokens.content';

const route = getRouteApi('/settings/tokens');

export function SettingsTokensContainer() {
  const navigate = useNavigate();
  const search = route.useSearch();
  const groups = useGroupsList();
  const toast = useToast();
  const tokens = useApiTokens();
  const mcpInfo = useMcpInfo();
  const createToken = useCreateApiToken();
  const revokeToken = useRevokeApiToken();

  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateApiTokenResponse | null>(null);
  const [revoking, setRevoking] = useState<IApiToken | null>(null);

  const handleCreate = async (input: CreateApiTokenInput) => {
    setCreateError(null);
    try {
      setCreated(await createToken.mutateAsync(input));
      return true;
    } catch (err) {
      setCreateError(
        getErrorStatus(err) === 409
          ? getErrorMessage(err, 'You have the most tokens allowed. Revoke one to create a new one.')
          : getErrorMessage(err, "Couldn't create the token."),
      );
      return false;
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    try {
      await revokeToken.mutateAsync(revoking._id);
      toast.success(`“${revoking.name}” revoked`);
      setRevoking(null);
      setCreateError(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't revoke the token."));
    }
  };

  return (
    <SettingsTokensContent
      onBack={() => navigate({ to: '/' })}
      mcpUrl={mcpInfo.data?.url}
      mcpError={mcpInfo.isError ? getErrorMessage(mcpInfo.error) : null}
      onRetryMcp={() => mcpInfo.refetch()}
      tokens={tokens.data ?? []}
      tokensLoading={tokens.isLoading}
      tokensError={tokens.isError ? getErrorMessage(tokens.error) : null}
      onRetryTokens={() => tokens.refetch()}
      isRetryingTokens={tokens.isFetching}
      groups={groups.data ?? []}
      groupsLoading={groups.isLoading}
      preferredGroupId={search.group}
      onCreate={handleCreate}
      isCreating={createToken.isPending}
      createError={createError}
      created={created}
      onCreatedDone={() => setCreated(null)}
      revoking={revoking}
      isRevoking={revokeToken.isPending}
      onRevokeRequest={setRevoking}
      onRevokeConfirm={handleRevoke}
      onRevokeCancel={() => setRevoking(null)}
    />
  );
}
