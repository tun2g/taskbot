import type { AdminRange, AdminUserRow } from '@tbot/shared';

import { Card, PageHeader } from '@/components/ui/card';
import { Pagination } from '@/components/ui/nav';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import type { UserSort } from '@/lib/labels';
import type { ActiveWindow } from '@/lib/search';

import { UsersEmpty } from './components/users-empty';
import { UsersTable } from './components/users-table';
import { UsersToolbar } from './components/users-toolbar';

export function UsersContent(props: {
  rows: AdminUserRow[];
  range: AdminRange;
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  query: string;
  onQuery: (q: string) => void;
  searched: boolean;
  activeIn?: ActiveWindow;
  onClearActive: () => void;
  hasTokens: boolean;
  onClearTokens: () => void;
  sort: UserSort;
  onSort: (sort: UserSort) => void;
  onPage: (page: number) => void;
  onOpen: (userId: string) => void;
  defaultLabel: string;
}) {
  const { rows } = props;
  return (
    <>
      <PageHeader
        title="People"
        subtitle="Everyone who has used the bot in any group. Open a person to see their groups, AI use and MCP tokens."
      />
      <Card>
        <UsersToolbar {...props} />
        {props.isLoading ? (
          <TableSkeleton />
        ) : props.error ? (
          <ErrorState message={props.error} onRetry={props.onRetry} retrying={props.retrying} />
        ) : rows.length === 0 ? (
          <UsersEmpty hasTokens={props.hasTokens} activeIn={!!props.activeIn} searched={props.searched} query={props.query} />
        ) : (
          <>
            <UsersTable rows={rows} range={props.range} sort={props.sort} onSort={props.onSort} onOpen={props.onOpen} defaultLabel={props.defaultLabel} />
            <Pagination page={props.page} limit={props.limit} total={props.total} onPage={props.onPage} noun="people" />
          </>
        )}
      </Card>
      <p className="mt-3 text-[13px] text-text-3">
        Click a column name to sort. Numbers cover the period picked at the top and match each person’s page. Est. AI cost is
        token counts × your price table (Settings); click an AI number to see the calls behind it.
      </p>
    </>
  );
}
