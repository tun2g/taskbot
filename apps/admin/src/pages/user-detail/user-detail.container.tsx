import { getRouteApi } from '@tanstack/react-router';

import { useAiSettings } from '@/api/settings';
import { useRevokeUserTokens, useSetUserAi, useUser } from '@/api/users';
import { useRevokeTokenFlow } from '@/components/tokens/use-revoke-token';
import { useTokenList } from '@/components/tokens/use-token-list';
import { rangeStart, useTrackingSince } from '@/components/tracking-notice';
import { defaultPersonLimit, personLimitsNow } from '@/lib/ai-limits';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { DEFAULT_RANGE } from '@/lib/search';
import { useScrollToHash } from '@/lib/use-scroll-to-hash';

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
  const revokeAll = useRevokeUserTokens();
  const revokeOne = useRevokeTokenFlow();
  const activeTokens = useTokenList({ status: 'active', userId });
  const endedTokens = useTokenList({ status: 'ended', userId });
  useScrollToHash(!!user.data);

  const fallback = defaultPersonLimit(settings.data);
  const defaultLimitText = fallback == null ? 'the per-person limit from Settings' : `${formatNumber(fallback)} calls per day (from Settings)`;
  const rightNow = user.data ? personLimitsNow(settings.data, { disabled: user.data.aiDisabled, dailyLimit: user.data.aiDailyLimit }) : '';

  return (
    <>
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
        rightNow={rightNow}
        savingAi={setAi.isPending}
        onSaveAi={(input) => setAi.mutate({ id: userId, ...input })}
        activeTokens={activeTokens}
        endedTokens={endedTokens}
        onRevokeToken={revokeOne.ask}
        revokingAll={revokeAll.isPending}
        onRevokeAll={(name, done) => revokeAll.mutate({ id: userId, name }, { onSettled: done })}
      />
      {revokeOne.dialog}
    </>
  );
}
