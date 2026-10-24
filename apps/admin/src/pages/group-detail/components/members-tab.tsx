import type { AdminRange } from '@tbot/shared';

import { useGroupMembers } from '@/api/groups';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/input';
import { Pagination } from '@/components/ui/nav';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { getErrorMessage } from '@/lib/api-client';
import { RANGE_LABELS } from '@/lib/labels';
import { useUrlSearchBox } from '@/lib/use-url-search-box';

import { useDetailSearch } from '../use-detail-search';
import { MembersTable } from './members-table';

const LIMIT = 25;

/** People in this group who used the bot — paged, searchable and sortable on the server. */
export function MembersTab({ range, onOpenPerson }: { range: AdminRange; onOpenPerson: (userId: string) => void }) {
  const { groupId, search, update } = useDetailSearch();
  const page = search.page ?? 1;
  const sort = search.sort ?? 'events';
  const members = useGroupMembers(groupId, { range, q: search.q, sort, page, limit: LIMIT });
  const box = useUrlSearchBox(search.q, (q) => update({ q, page: undefined }));
  const rows = members.data?.data ?? [];

  return (
    <Card>
      <CardHeader
        title="People using the bot"
        subtitle={`People in this group who have used the bot. Activity, AI and task numbers cover the ${RANGE_LABELS[range].toLowerCase()}. Click a column name to sort, a row to open the person.`}
      />
      <div className="px-5 pb-3">
        <SearchInput value={box.query} onChange={box.setQuery} placeholder="Search name or @username" className="w-full sm:w-72" />
      </div>
      {members.isError ? (
        <ErrorState message={getErrorMessage(members.error)} onRetry={() => void members.refetch()} retrying={members.isFetching} />
      ) : members.isLoading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        search.q ? (
          <EmptyState
            title={`Nobody matches “${search.q}”.`}
            body="Search looks at names and @usernames."
            action={
              <Button size="sm" onClick={box.clear}>
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Nobody in this group has used the bot yet."
            body="People appear here after their first command, button tap or Mini App visit."
          />
        )
      ) : (
        <div className={members.isFetching ? 'opacity-70 transition-opacity' : undefined}>
          <MembersTable
            rows={rows}
            groupId={groupId}
            range={range}
            sort={sort}
            onSort={(s) => update({ sort: s === 'events' ? undefined : s, page: undefined })}
            onOpenPerson={onOpenPerson}
          />
          <Pagination
            page={page}
            limit={members.data?.meta.limit ?? LIMIT}
            total={members.data?.meta.total ?? 0}
            onPage={(p) => update({ page: p > 1 ? p : undefined })}
            noun="people"
          />
        </div>
      )}
    </Card>
  );
}
