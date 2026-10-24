import type { AdminGroupTaskFilter, AdminRange } from '@tbot/shared';

import { useGroupTasks } from '@/api/groups';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/nav';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { getErrorMessage } from '@/lib/api-client';

import { TasksTable } from './tasks-table';

const EMPTY: Record<AdminGroupTaskFilter, string> = {
  open: 'No open tasks — everything is done.',
  overdue: 'Nothing is overdue.',
  done: 'No finished tasks yet.',
  all: 'This group has no tasks yet.',
};

/** One filter of the group's tasks, paged. */
export function TaskList({
  groupId,
  filter,
  createdIn,
  q,
  page,
  onPage,
  onClearSearch,
}: {
  groupId: string;
  filter: AdminGroupTaskFilter;
  createdIn: AdminRange | undefined;
  q: string | undefined;
  page: number;
  onPage: (page: number) => void;
  onClearSearch: () => void;
}) {
  const tasks = useGroupTasks(groupId, { filter, createdIn, q, page, limit: 25 });
  const rows = tasks.data?.data ?? [];
  if (tasks.isError) return <ErrorState message={getErrorMessage(tasks.error)} onRetry={() => void tasks.refetch()} retrying={tasks.isFetching} />;
  if (tasks.isLoading) return <TableSkeleton />;
  if (rows.length === 0) {
    return q ? (
      <EmptyState
        title={`No tasks match “${q}”.`}
        body="Search looks at task titles and numbers (#42)."
        action={
          <Button size="sm" onClick={onClearSearch}>
            Clear search
          </Button>
        }
      />
    ) : (
      <EmptyState title={EMPTY[filter]} body={createdIn ? 'Only tasks created in the selected period are shown.' : undefined} />
    );
  }
  return (
    <div className={tasks.isFetching ? 'opacity-70 transition-opacity' : undefined}>
      <TasksTable rows={rows} />
      <Pagination page={page} limit={tasks.data?.meta.limit ?? 25} total={tasks.data?.meta.total ?? 0} onPage={onPage} noun="tasks" />
    </div>
  );
}
