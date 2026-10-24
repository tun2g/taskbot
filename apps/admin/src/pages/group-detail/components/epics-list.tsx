import { useGroupEpics } from '@/api/groups';
import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/nav';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { RelativeTime } from '@/components/ui/values';
import { getErrorMessage } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';

/** The group's epics with how many of their tasks are still open (paged). */
export function EpicsList({ groupId, page, onPage }: { groupId: string; page: number; onPage: (page: number) => void }) {
  const epics = useGroupEpics(groupId, page);
  const rows = epics.data?.data ?? [];
  if (epics.isError) return <ErrorState message={getErrorMessage(epics.error)} onRetry={() => void epics.refetch()} retrying={epics.isFetching} />;
  if (epics.isLoading) return <TableSkeleton />;
  if (rows.length === 0) return <EmptyState title="This group has no epics." body="Epics group related tasks; people create them in the Mini App." />;

  return (
    <div className={epics.isFetching ? 'opacity-70 transition-opacity' : undefined}>
      <Table>
        <THead>
          <Th>Epic</Th>
          <Th>Status</Th>
          <Th align="right" hint="open / all">
            Tasks
          </Th>
          <Th>Created</Th>
        </THead>
        <tbody>
          {rows.map((e) => (
            <Tr key={e.id}>
              <Td className="max-w-96 text-text">{e.title}</Td>
              <Td>
                <Badge tone={e.status === 'done' ? 'good' : 'accent'}>{e.status === 'done' ? 'Done' : 'Open'}</Badge>
              </Td>
              <Td align="right">
                <span className="text-text">{formatNumber(e.openTasks)}</span>
                <span className="text-text-3"> / {formatNumber(e.tasks)}</span>
              </Td>
              <Td>
                <RelativeTime value={e.createdAt} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} limit={epics.data?.meta.limit ?? 25} total={epics.data?.meta.total ?? 0} onPage={onPage} noun="epics" />
    </div>
  );
}
