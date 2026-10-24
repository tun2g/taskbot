import type { AdminMcpTokenRow } from '@tbot/shared';

import { Pagination } from '@/components/ui/nav';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';

import { TokensTable } from './tokens-table';
import type { TokenList } from './use-token-list';

/** A token list inside a card: loading / error / empty / the table + pagination. */
export function TokenListBody({
  list,
  mode,
  empty,
  showOwner,
  onRevoke,
  onOpenOwner,
}: {
  list: TokenList;
  mode: 'active' | 'history';
  empty: { title: string; body?: string };
  showOwner?: boolean;
  onRevoke?: (token: AdminMcpTokenRow) => void;
  onOpenOwner?: (token: AdminMcpTokenRow) => void;
}) {
  if (list.isLoading) return <TableSkeleton rows={3} />;
  if (list.error) return <ErrorState message={list.error} onRetry={list.onRetry} retrying={list.retrying} />;
  if (list.rows.length === 0) return <EmptyState compact title={empty.title} body={empty.body} />;
  return (
    <>
      <TokensTable tokens={list.rows} mode={mode} showOwner={showOwner} onRevoke={onRevoke} onOpenOwner={onOpenOwner} />
      <Pagination page={list.page} limit={list.limit} total={list.total} onPage={list.onPage} noun="tokens" />
    </>
  );
}
