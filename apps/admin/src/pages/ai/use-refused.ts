import type { AdminRange } from '@tbot/shared';
import { useEffect, useState } from 'react';

import { useAiRefused } from '@/api/ai';
import { getErrorMessage } from '@/lib/api-client';

const PAGE_SIZE = 10;

/** "Refused (limit) — who": by person or by group, paginated, for the same range and filter as the page. */
export function useRefused(params: { range: AdminRange; groupId?: string; userId?: string }) {
  const [by, setBy] = useState<'person' | 'group'>('person');
  const [page, setPage] = useState(1);
  const { range, groupId, userId } = params;
  useEffect(() => setPage(1), [by, range, groupId, userId]);
  const query = useAiRefused({ by, range, groupId, userId, page, limit: PAGE_SIZE });
  return {
    by,
    onBy: setBy,
    rows: query.data?.data ?? [],
    total: query.data?.meta.total ?? 0,
    page,
    limit: PAGE_SIZE,
    onPage: setPage,
    isLoading: query.isLoading,
    error: query.isError ? getErrorMessage(query.error) : null,
    onRetry: () => void query.refetch(),
    retrying: query.isFetching,
  };
}

export type RefusedList = ReturnType<typeof useRefused>;
