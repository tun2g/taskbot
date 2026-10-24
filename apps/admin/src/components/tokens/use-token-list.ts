import type { AdminMcpTokenFilter } from '@tbot/shared';
import { useEffect, useState } from 'react';

import { useMcpTokens } from '@/api/mcp';
import { getErrorMessage } from '@/lib/api-client';

export const TOKENS_PAGE_SIZE = 10;

/** One paginated token list (its own page number, back to page 1 when the filter changes). */
export function useTokenList(params: { status: AdminMcpTokenFilter; userId?: string; q?: string }, opts: { enabled?: boolean } = {}) {
  const [page, setPage] = useState(1);
  const { status, userId, q } = params;
  useEffect(() => setPage(1), [status, userId, q]);
  const query = useMcpTokens({ status, userId, q: q || undefined, page, limit: TOKENS_PAGE_SIZE }, opts);
  return {
    rows: query.data?.data ?? [],
    total: query.data?.meta.total ?? 0,
    page,
    limit: TOKENS_PAGE_SIZE,
    onPage: setPage,
    isLoading: query.isLoading,
    error: query.isError ? getErrorMessage(query.error) : null,
    onRetry: () => void query.refetch(),
    retrying: query.isFetching,
  };
}

export type TokenList = ReturnType<typeof useTokenList>;
