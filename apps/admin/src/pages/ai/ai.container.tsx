import { getRouteApi } from '@tanstack/react-router';
import { useCallback } from 'react';

import { useAiCalls, useAiUsage } from '@/api/ai';
import { useGroup } from '@/api/groups';
import { useUser } from '@/api/users';
import { rangeStart, useTrackingSince } from '@/components/tracking-notice';
import { getErrorMessage } from '@/lib/api-client';
import { personName } from '@/lib/format';
import { type AiSearch, DEFAULT_RANGE } from '@/lib/search';

import { AiContent } from './ai.content';

const route = getRouteApi('/_app/ai');

export const CALLS_PAGE_SIZE = 25;

export function AiContainer() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const range = search.range ?? DEFAULT_RANGE;
  const groupBy = search.groupBy ?? 'feature';
  const page = search.page ?? 1;

  const usage = useAiUsage({ range, groupBy, groupId: search.groupId, userId: search.userId });
  const daily = useAiUsage({ range, groupBy: 'day', groupId: search.groupId, userId: search.userId });
  const calls = useAiCalls({
    range,
    status: search.status,
    feature: search.feature,
    groupId: search.groupId,
    userId: search.userId,
    page,
    limit: CALLS_PAGE_SIZE,
  });
  const group = useGroup(search.groupId ?? '', range, { enabled: !!search.groupId });
  const user = useUser(search.userId ?? '', range, { enabled: !!search.userId });
  const { trackingSince, loaded: trackingLoaded } = useTrackingSince(range);

  /** Change filters in the URL; any filter change goes back to page 1 of the calls. */
  const update = useCallback(
    (patch: Partial<AiSearch>, opts: { scrollToCalls?: boolean } = {}) => {
      void navigate({
        to: '.',
        search: (prev: AiSearch): AiSearch => ({ ...prev, page: undefined, ...patch }),
        replace: !opts.scrollToCalls,
      }).then(() => {
        if (opts.scrollToCalls) {
          document.getElementById('ai-calls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    },
    [navigate],
  );

  const dailyRows = groupBy === 'day' ? usage.data?.rows : daily.data?.rows;

  return (
    <AiContent
      range={range}
      groupBy={groupBy}
      filters={{
        groupId: search.groupId,
        groupLabel: group.data?.name ?? (group.isLoading ? 'Loading…' : group.isError ? 'Deleted group' : 'Selected group'),
        userId: search.userId,
        userLabel: user.data ? personName(user.data.person) : user.isLoading ? 'Loading…' : 'Selected person',
        status: search.status,
        feature: search.feature,
      }}
      usage={usage.data}
      usageLoading={usage.isLoading}
      usageError={usage.isError ? getErrorMessage(usage.error) : null}
      onRetryUsage={() => void usage.refetch()}
      usageRetrying={usage.isFetching}
      dailyRows={dailyRows}
      dailyLoading={groupBy === 'day' ? usage.isLoading : daily.isLoading}
      trackingSince={trackingLoaded ? trackingSince : undefined}
      rangeFrom={rangeStart(range)}
      calls={calls.data}
      callsLoading={calls.isLoading}
      callsError={calls.isError ? getErrorMessage(calls.error) : null}
      onRetryCalls={() => void calls.refetch()}
      callsRetrying={calls.isFetching}
      page={page}
      pageSize={CALLS_PAGE_SIZE}
      onUpdate={update}
    />
  );
}
