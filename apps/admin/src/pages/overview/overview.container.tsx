import { getRouteApi } from '@tanstack/react-router';

import { useOverview } from '@/api/overview';
import { useGroupLifecycle } from '@/components/actions/group-actions';
import { getErrorMessage } from '@/lib/api-client';
import { DEFAULT_RANGE } from '@/lib/search';

import { OverviewContent } from './overview.content';

const route = getRouteApi('/_app/');

export function OverviewContainer() {
  const { range = DEFAULT_RANGE } = route.useSearch();
  const overview = useOverview(range);
  const lifecycle = useGroupLifecycle();

  return (
    <>
      <OverviewContent
        range={range}
        overview={overview.data}
        isLoading={overview.isLoading}
        isRefreshing={overview.isFetching && !overview.isLoading}
        error={overview.isError && !overview.data ? getErrorMessage(overview.error) : null}
        onRetry={() => void overview.refetch()}
        onGroupAction={lifecycle.request}
        busyGroupId={lifecycle.pendingId}
      />
      {lifecycle.dialog}
    </>
  );
}
