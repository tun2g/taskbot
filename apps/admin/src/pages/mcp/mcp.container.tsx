import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useMcpOverview } from '@/api/mcp';
import { useRevokeTokenFlow } from '@/components/tokens/use-revoke-token';
import { useTokenList } from '@/components/tokens/use-token-list';
import { rangeStart, useTrackingSince } from '@/components/tracking-notice';
import { getErrorMessage } from '@/lib/api-client';
import { DEFAULT_RANGE } from '@/lib/search';
import { useScrollToHash } from '@/lib/use-scroll-to-hash';

import { McpTokensCard } from './components/mcp-tokens-card';
import { McpContent } from './mcp.content';

const route = getRouteApi('/_app/mcp');

/** The text a search box shows now, and the value 300 ms after typing stops (what is sent to the API). */
function useDebounced(delay = 300) {
  const [value, setValue] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return { value, setValue, debounced };
}

export function McpContainer() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const range = search.range ?? DEFAULT_RANGE;
  const mcp = useMcpOverview(range, { tool: search.tool, client: search.client });
  const { trackingSince } = useTrackingSince(range);
  const q = useDebounced();
  const tokens = useTokenList({ status: 'active', q: q.debounced });
  const revoke = useRevokeTokenFlow();
  useScrollToHash(!!mcp.data);

  const openPerson = (userId: string) => navigate({ to: '/users/$userId', params: { userId }, search: { range } });

  return (
    <>
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
        onOpenPerson={openPerson}
        onOpenGroup={(groupId) => navigate({ to: '/groups/$groupId', params: { groupId }, search: { range } })}
        tokens={
          <McpTokensCard
            list={tokens}
            query={q.value}
            onQuery={q.setValue}
            onRevoke={revoke.ask}
            onOpenOwner={(t) => t.person?.id && openPerson(t.person.id)}
          />
        }
      />
      {revoke.dialog}
    </>
  );
}
