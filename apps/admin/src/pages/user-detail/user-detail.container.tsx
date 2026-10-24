import { getRouteApi } from '@tanstack/react-router';

import { useAiSettings } from '@/api/settings';
import { useRevokeUserTokens, useSetUserAi, useUser } from '@/api/users';
import { rangeStart, useTrackingSince } from '@/components/tracking-notice';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';
import { DEFAULT_RANGE } from '@/lib/search';

import { UserDetailContent } from './user-detail.content';

const route = getRouteApi('/_app/users/$userId');

export function UserDetailContainer() {
  const { userId } = route.useParams();
  const search = route.useSearch();
  const range = search.range ?? DEFAULT_RANGE;

  const user = useUser(userId, range);
  const { trackingSince } = useTrackingSince(range);
  const settings = useAiSettings();
  const setAi = useSetUserAi();
  const revoke = useRevokeUserTokens();

  const defaultLimit = settings.data ? (settings.data.userDailyLimit ?? settings.data.defaults.userDailyLimit) : null;
  const defaultLimitText =
    defaultLimit == null
      ? 'the per-person limit from Settings'
      : defaultLimit === 0
        ? 'no per-person limit (from Settings)'
        : `${defaultLimit} calls per day (from Settings)`;

  return (
    <UserDetailContent
      user={user.data}
      range={range}
      isLoading={user.isLoading}
      notFound={getErrorStatus(user.error) === 404}
      error={user.isError ? getErrorMessage(user.error) : null}
      onRetry={() => user.refetch()}
      retrying={user.isFetching}
      trackingSince={trackingSince}
      from={rangeStart(range)}
      defaultLimitText={defaultLimitText}
      savingAi={setAi.isPending}
      onSaveAi={(input) => setAi.mutate({ id: userId, ...input })}
      revoking={revoke.isPending}
      onRevokeTokens={(name, done) => revoke.mutate({ id: userId, name }, { onSettled: done })}
    />
  );
}
