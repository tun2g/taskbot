import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useAiSettings } from '@/api/settings';
import { useUsers } from '@/api/users';
import { defaultLimitLabel } from '@/lib/ai-limits';
import { getErrorMessage } from '@/lib/api-client';
import type { UserSort } from '@/lib/labels';
import { DEFAULT_RANGE } from '@/lib/search';

import { UsersContent } from './users.content';

const route = getRouteApi('/_app/users/');
const LIMIT = 20;

export function UsersContainer() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const page = search.page ?? 1;
  const sort: UserSort = search.sort ?? 'lastSeen';
  const range = search.range ?? DEFAULT_RANGE;
  const settings = useAiSettings();

  // The box updates instantly; the URL (and the request) follow 300 ms after typing stops.
  const [query, setQuery] = useState(search.q ?? '');
  useEffect(() => setQuery(search.q ?? ''), [search.q]);
  useEffect(() => {
    const q = query.trim() || undefined;
    if (q === search.q) return;
    const t = setTimeout(() => navigate({ search: (prev) => ({ ...prev, q, page: undefined }), replace: true }), 300);
    return () => clearTimeout(t);
  }, [query, search.q, navigate]);

  const users = useUsers({ range, activeIn: search.activeIn, hasTokens: search.hasTokens ? '1' : undefined, q: search.q, sort, page, limit: LIMIT });

  return (
    <UsersContent
      rows={users.data?.data ?? []}
      range={range}
      defaultLabel={defaultLimitLabel(settings.data)}
      total={users.data?.meta.total ?? 0}
      page={page}
      limit={LIMIT}
      isLoading={users.isLoading}
      error={users.isError ? getErrorMessage(users.error) : null}
      onRetry={() => users.refetch()}
      retrying={users.isFetching}
      query={query}
      onQuery={setQuery}
      searched={!!search.q}
      activeIn={search.activeIn}
      onClearActive={() => navigate({ search: (prev) => ({ ...prev, activeIn: undefined, page: undefined }) })}
      hasTokens={!!search.hasTokens}
      onClearTokens={() => navigate({ search: (prev) => ({ ...prev, hasTokens: undefined, page: undefined }) })}
      sort={sort}
      onSort={(s) => navigate({ search: (prev) => ({ ...prev, sort: s === 'lastSeen' ? undefined : s, page: undefined }) })}
      onPage={(p) => navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })}
      onOpen={(userId) => navigate({ to: '/users/$userId', params: { userId }, search: { range } })}
    />
  );
}
