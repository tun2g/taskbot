import type { ITask, TaskCounts, TaskStatus } from '@tbot/shared';
import { TASK_BOARD_DEFAULT_STATUSES, TASK_STATUS_LABELS, TASK_STATUS_ORDER } from '@tbot/shared';
import { type ReactNode, useMemo } from 'react';

import { flattenTaskPages } from '@/api/task-cache';
import { type ApiTaskFilters, useTaskPages } from '@/api/tasks';
import { statusText } from '@/components/ui/badges';
import { Checkbox } from '@/components/ui/checkbox';
import { getErrorMessage } from '@/lib/api-client';

import { KanbanBoard, KanbanColumnView } from './kanban-board';

interface StatusBoardProps {
  groupId: string;
  /** Board filters (no status); each column adds its own `status`. */
  filters: ApiTaskFilters;
  /** Per-status totals for the same filters; null while loading. */
  counts: TaskCounts | null;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
  onStatusChange: (task: ITask, status: TaskStatus) => void;
  renderCard: (task: ITask, isOverlay?: boolean) => ReactNode;
}

/**
 * Status board: one column per visible status, each paging its own
 * GET /groups/:id/tasks?status=<column>&… (hidden statuses aren't fetched).
 */
export function StatusBoard({
  groupId,
  filters,
  counts,
  showAll,
  onShowAllChange,
  onStatusChange,
  renderCard,
}: StatusBoardProps) {
  const visible = showAll ? TASK_STATUS_ORDER : TASK_BOARD_DEFAULT_STATUSES;
  const hiddenCount =
    showAll || !counts ? 0 : counts.total - visible.reduce((n, s) => n + (counts.byStatus[s] ?? 0), 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2">
        <p className="text-xs text-tg-hint">
          {hiddenCount > 0
            ? `${hiddenCount} task${hiddenCount === 1 ? '' : 's'} in Backlog, Pending or Cancelled are hidden.`
            : 'Drag cards between columns, or use ⋯ on a card.'}
        </p>
        <Checkbox checked={showAll} onChange={onShowAllChange}>
          Show all statuses
        </Checkbox>
      </div>
      <KanbanBoard
        renderCard={(task, { isOverlay }) => renderCard(task, isOverlay)}
        onMove={(task, _from, to) => onStatusChange(task, to as TaskStatus)}
      >
        {visible.map((status) => (
          <StatusColumn
            key={status}
            groupId={groupId}
            filters={filters}
            status={status}
            count={counts ? (counts.byStatus[status] ?? 0) : null}
          />
        ))}
      </KanbanBoard>
    </>
  );
}

function StatusColumn({
  groupId,
  filters,
  status,
  count,
}: {
  groupId: string;
  filters: ApiTaskFilters;
  status: TaskStatus;
  count: number | null;
}) {
  const columnFilters = useMemo(() => ({ ...filters, status }), [filters, status]);
  const query = useTaskPages(groupId, columnFilters);
  const tasks = useMemo(() => flattenTaskPages(query.data), [query.data]);
  // The column's own total is exact for what it pages through; the counts call fills in before it loads.
  const total = query.data?.pages.at(-1)?.meta.total ?? count;

  return (
    <KanbanColumnView
      column={{
        id: status,
        title: statusText(status),
        label: TASK_STATUS_LABELS[status],
        count: total,
        tasks,
        isLoading: query.isLoading,
        error: query.isError && !query.data ? getErrorMessage(query.error) : null,
        onRetry: () => void query.refetch(),
        hasMore: query.hasNextPage,
        isFetchingMore: query.isFetchingNextPage,
        // Don't cut short a refetch of the loaded pages (after a move / create).
        onLoadMore: () => {
          if (!query.isFetching) void query.fetchNextPage();
        },
        autoLoad: !query.isFetchNextPageError,
        isRefetching: query.isFetching && !query.isFetchingNextPage,
      }}
    />
  );
}
