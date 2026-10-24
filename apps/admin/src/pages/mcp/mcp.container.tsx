import { getRouteApi } from '@tanstack/react-router';

import { useMcpOverview } from '@/api/mcp';
import { rangeStart, useTrackingSince } from '@/components/tracking-notice';
import { getErrorMessage } from '@/lib/api-client';
import { DEFAULT_RANGE } from '@/lib/search';

import { McpContent } from './mcp.content';

const route = getRouteApi('/_app/mcp');

export function McpContainer() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const range = search.range ?? DEFAULT_RANGE;
  const filter = { tool: search.tool, client: search.client };
  const mcp = useMcpOverview(range, filter);
  const { trackingSince } = useTrackingSince(range);

  return (
    <McpContent
      data={mcp.data}
      range={range}
      tool={search.tool}
      client={search.client}
      onFilter={(next) => navigate({ search: (prev) => ({ ...prev, ...next }) })}
      isLoading={mcp.isLoading}
      error={mcp.isError ? getErrorMessage(mcp.error) : null}
      onRetry={() => mcp.refetch()}
      retrying={mcp.isFetching}
      trackingSince={trackingSince}
      from={rangeStart(range)}
    />
  );
}
