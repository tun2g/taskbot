import type { AdminGroupRef, AdminGroupRow, AdminRange } from '@tbot/shared';
import { GROUP_STATUS_HINTS, GROUP_STATUS_LABELS, GROUP_STATUS_VALUES, GroupStatus } from '@tbot/shared';

import type { GroupLifecycleAction } from '@/components/actions/group-actions';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { SearchInput, Select } from '@/components/ui/input';
import { FilterChip, Pagination, type TabItem, Tabs } from '@/components/ui/nav';
import { EmptyState, ErrorState, Notice, TableSkeleton } from '@/components/ui/states';
import { formatNumber } from '@/lib/format';
import { GROUP_SORT_LABELS, type GroupSort, RANGE_LABELS } from '@/lib/labels';

/** With a period filter, "activity" and "tasks" are counted inside the period. */
const PERIOD_SORT_LABELS: Partial<Record<GroupSort, string>> = {
  lastActivity: 'Most requests in the period',
  tasks: 'Tasks created in the period',
};

import { GroupsTable } from './components/groups-table';

export type StatusTab = 'all' | GroupStatus;

const EMPTY: Record<StatusTab, { title: string; body: string }> = {
  all: {
    title: 'The bot isn’t in any group yet.',
    body: 'When someone adds the bot to a Telegram group, the group shows up here waiting for your approval.',
  },
  [GroupStatus.PENDING]: {
    title: 'No groups are waiting for approval.',
    body: 'When someone adds the bot to a new group, it shows up here for you to approve or reject.',
  },
  [GroupStatus.ACTIVE]: {
    title: 'No active groups yet.',
    body: 'Approve a waiting group and it shows up here.',
  },
  [GroupStatus.SUSPENDED]: {
    title: 'No suspended groups.',
    body: 'Suspending pauses a group’s service without deleting its tasks.',
  },
  [GroupStatus.REJECTED]: {
    title: 'You haven’t rejected any groups.',
    body: 'Groups you decline from the approval queue are listed here.',
  },
  [GroupStatus.LEFT]: {
    title: 'The bot hasn’t been removed from any group.',
    body: 'Groups where someone removed the bot (or you made it leave) are listed here. Their tasks are kept.',
  },
  [GroupStatus.MIGRATED]: {
    title: 'No groups have moved to a supergroup.',
    body: 'When Telegram upgrades a basic group to a supergroup, the old chat is listed here.',
  },
};

export function GroupsContent({
  rows,
  total,
  page,
  limit,
  isLoading,
  isFetching,
  error,
  onRetry,
  status,
  counts,
  query,
  appliedQuery,
  sort,
  onStatus,
  onQuery,
  onClearQuery,
  onSort,
  onPage,
  onOpen,
  onAction,
  busyId,
  activeIn,
  onClearActive,
}: {
  rows: AdminGroupRow[];
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  onRetry: () => void;
  status: StatusTab;
  counts: Partial<Record<StatusTab, number>> | undefined;
  query: string;
  appliedQuery: string | undefined;
  sort: GroupSort;
  onStatus: (status: StatusTab) => void;
  onQuery: (q: string) => void;
  onClearQuery: () => void;
  onSort: (sort: GroupSort) => void;
  onPage: (page: number) => void;
  onOpen: (groupId: string) => void;
  onAction: (action: GroupLifecycleAction, group: AdminGroupRef) => void;
  busyId: string | undefined;
  activeIn?: AdminRange;
  onClearActive: () => void;
}) {
  const tabs: TabItem<StatusTab>[] = [
    { value: 'all', label: 'All', count: counts?.all, hint: 'Every group the bot has been added to' },
    ...GROUP_STATUS_VALUES.map((s) => ({
      value: s as StatusTab,
      label: GROUP_STATUS_LABELS[s],
      count: counts?.[s],
      hint: GROUP_STATUS_HINTS[s],
    })),
  ];

  const empty = appliedQuery
    ? {
        title: `No groups match “${appliedQuery}”.`,
        body: 'Search looks at group names. Try a shorter word or another status tab.',
      }
    : activeIn
      ? { title: 'No group had activity in this period.', body: 'Remove the period filter to see every group.' }
      : EMPTY[status];

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Each Telegram group the bot was added to is a separate workspace with its own tasks and members. New groups wait for your approval before the bot works there."
      />

      <Tabs items={tabs} value={status} onChange={onStatus} className="mb-4" />

      {status !== 'all' && (
        <p className="-mt-2 mb-3 text-sm text-text-3">{GROUP_STATUS_HINTS[status]}</p>
      )}

      {status === GroupStatus.PENDING && (
        <div className="mb-4">
          <Notice>
            Approving lets the bot work in the group and posts a welcome message there. Rejecting posts your reason in
            the group and the bot leaves; nothing is deleted.
          </Notice>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <SearchInput value={query} onChange={onQuery} placeholder="Search groups by name" className="w-full sm:w-72" />
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-sm whitespace-nowrap text-text-2">
            Sort by
            <Select value={sort} onChange={(e) => onSort(e.target.value as GroupSort)}>
              {(Object.keys(GROUP_SORT_LABELS) as GroupSort[]).map((k) => (
                <option key={k} value={k}>
                  {(activeIn && PERIOD_SORT_LABELS[k]) || GROUP_SORT_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {activeIn && (
          <div className="px-5 pb-3">
            <FilterChip
              label={
                <>
                  Active in the {RANGE_LABELS[activeIn].toLowerCase()} · {formatNumber(total)}
                </>
              }
              onRemove={onClearActive}
            />
          </div>
        )}

        {error ? (
          <ErrorState message={error} onRetry={onRetry} retrying={isFetching} title="Couldn’t load groups" />
        ) : isLoading ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState
            title={empty.title}
            body={empty.body}
            action={
              appliedQuery ? (
                <Button size="sm" onClick={onClearQuery}>
                  Clear search
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <GroupsTable rows={rows} onOpen={onOpen} onAction={onAction} busyId={busyId} />
            <Pagination page={page} limit={limit} total={total} onPage={onPage} noun="groups" />
          </div>
        )}
      </Card>
    </>
  );
}
