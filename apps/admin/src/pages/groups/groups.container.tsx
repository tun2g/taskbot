import { GROUP_STATUS_VALUES, GroupStatus } from '@tbot/shared';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useGroups } from '@/api/groups';
import { useOverview } from '@/api/overview';
import { useGroupLifecycle } from '@/components/actions/group-actions';
import { getErrorMessage } from '@/lib/api-client';
import type { GroupSort } from '@/lib/labels';
import { DEFAULT_RANGE } from '@/lib/search';

import { GroupsContent, type StatusTab } from './groups.content';
import { useDebouncedValue } from './use-debounced-value';

const route = getRouteApi('/_app/groups/');
const LIMIT = 20;

export function GroupsContainer() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const page = search.page ?? 1;

  // The search box is local while typing; the URL follows after a short pause.
  const [query, setQuery] = useState(search.q ?? '');
  const debounced = useDebouncedValue(query.trim(), 300);
  useEffect(() => {
    if ((search.q ?? '') !== debounced) {
      void navigate({ search: (prev) => ({ ...prev, q: debounced || undefined, page: undefined }), replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    // Back/forward or a link changed q: reflect it in the box.
    setQuery(search.q ?? '');
  }, [search.q]);

  const groups = useGroups({ status: search.status, activeIn: search.activeIn, q: search.q, sort: search.sort, page, limit: LIMIT });
  const overview = useOverview(search.range ?? DEFAULT_RANGE);
  const lifecycle = useGroupLifecycle();

  const byStatus = overview.data?.groupsByStatus;
  const counts: Partial<Record<StatusTab, number>> | undefined = byStatus
    ? {
        all: GROUP_STATUS_VALUES.reduce((s, st) => s + (byStatus[st] ?? 0), 0),
        ...Object.fromEntries(GROUP_STATUS_VALUES.map((st) => [st, byStatus[st] ?? 0])),
      }
    : undefined;

  return (
    <>
      <GroupsContent
        rows={groups.data?.data ?? []}
        total={groups.data?.meta.total ?? 0}
        page={page}
        limit={groups.data?.meta.limit ?? LIMIT}
        isLoading={groups.isLoading}
        isFetching={groups.isFetching}
        error={groups.isError ? getErrorMessage(groups.error) : null}
        onRetry={() => void groups.refetch()}
        status={search.status ?? 'all'}
        counts={counts}
        query={query}
        appliedQuery={search.q}
        sort={search.sort ?? 'lastActivity'}
        onStatus={(status) =>
          void navigate({
            search: (prev) => ({ ...prev, status: status === 'all' ? undefined : (status as GroupStatus), page: undefined }),
          })
        }
        onQuery={setQuery}
        onClearQuery={() => setQuery('')}
        onSort={(sort: GroupSort) =>
          void navigate({ search: (prev) => ({ ...prev, sort: sort === 'lastActivity' ? undefined : sort, page: undefined }) })
        }
        onPage={(p) => void navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })}
        onOpen={(groupId) => void navigate({ to: '/groups/$groupId', params: { groupId } })}
        onAction={lifecycle.request}
        busyId={lifecycle.pendingId}
        activeIn={search.activeIn}
        onClearActive={() => void navigate({ search: (prev) => ({ ...prev, activeIn: undefined, page: undefined }) })}
      />
      {lifecycle.dialog}
    </>
  );
}
