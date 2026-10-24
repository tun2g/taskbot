import { getRouteApi } from '@tanstack/react-router';
import { useCallback } from 'react';

import { useAiCalls, useAiUsage } from '@/api/ai';
import { useGroup } from '@/api/groups';
import { useUser } from '@/api/users';
import { rangeStart, useTrackingSince } from '@/components/tracking-notice';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';
import { personName } from '@/lib/format';
import { type AiSearch, DEFAULT_RANGE } from '@/lib/search';
import { useScrollToHash } from '@/lib/use-scroll-to-hash';

import { AiContent } from './ai.content';
import { useRefused } from './use-refused';

const route = getRouteApi('/_app/ai');

export const CALLS_PAGE_SIZE = 25;

/** The name a filter chip shows: the real name once loaded, never a placeholder like "Selected person". */
function label(q: { data?: unknown; isLoading: boolean; error: unknown }, name: string | undefined, missing: string) {
  if (name) return name;
  if (q.isLoading) return 'Loading…';
  return getErrorStatus(q.error) === 404 ? missing : 'this filter';
}

export function AiContainer() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const range = search.range ?? DEFAULT_RANGE;
  const groupBy = search.groupBy ?? 'feature';
  const page = search.page ?? 1;
  const scope = { groupId: search.groupId, userId: search.userId };

  const usage = useAiUsage({ range, groupBy, ...scope });
  const daily = useAiUsage({ range, groupBy: 'day', ...scope });
  const calls = useAiCalls({ range, status: search.status, feature: search.feature, ...scope, page, limit: CALLS_PAGE_SIZE });
  const refused = useRefused({ range, ...scope });
  const group = useGroup(search.groupId ?? '', range, { enabled: !!search.groupId });
  const user = useUser(search.userId ?? '', range, { enabled: !!search.userId });
  const { trackingSince, loaded: trackingLoaded } = useTrackingSince(range);
  useScrollToHash(!!usage.data);

  /** Change filters in the URL; any filter change goes back to page 1 of the calls. */
  const update = useCallback(
    (patch: Partial<AiSearch>, opts: { scrollToCalls?: boolean } = {}) => {
      void navigate({
        to: '.',
        search: (prev: AiSearch): AiSearch => ({ ...prev, page: undefined, ...patch }),
        replace: !opts.scrollToCalls,
      }).then(() => {
        if (opts.scrollToCalls) document.getElementById('ai-calls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [navigate],
  );

  return (
    <AiContent
      range={range}
      groupBy={groupBy}
      filters={{
        groupId: search.groupId,
        groupLabel: label(group, group.data?.name, 'Deleted group'),
        groupDeleted: getErrorStatus(group.error) === 404,
        userId: search.userId,
        userLabel: label(user, user.data ? personName(user.data.person) : undefined, 'Unknown person'),
        status: search.status,
        feature: search.feature,
      }}
      usage={usage.data}
      usageLoading={usage.isLoading}
      usageError={usage.isError ? getErrorMessage(usage.error) : null}
      onRetryUsage={() => void usage.refetch()}
      usageRetrying={usage.isFetching}
      dailyRows={groupBy === 'day' ? usage.data?.rows : daily.data?.rows}
      dailyLoading={groupBy === 'day' ? usage.isLoading : daily.isLoading}
      trackingSince={trackingLoaded ? trackingSince : undefined}
      rangeFrom={rangeStart(range)}
      refused={refused}
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
