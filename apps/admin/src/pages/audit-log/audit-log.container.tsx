import { getRouteApi } from '@tanstack/react-router';

import { useAuditLog } from '@/api/audit';
import { getErrorMessage } from '@/lib/api-client';
import type { AuditTarget } from '@/lib/search';

import { AuditLogContent } from './audit-log.content';

const route = getRouteApi('/_app/audit-log');
const LIMIT = 25;

export function AuditLogContainer() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const page = search.page ?? 1;
  const log = useAuditLog({ targetType: search.targetType, targetId: search.targetId, page, limit: LIMIT });

  return (
    <AuditLogContent
      entries={log.data?.data ?? []}
      total={log.data?.meta.total ?? 0}
      page={page}
      limit={LIMIT}
      isLoading={log.isLoading}
      error={log.isError ? getErrorMessage(log.error) : null}
      onRetry={() => log.refetch()}
      retrying={log.isFetching}
      targetType={search.targetType}
      targetId={search.targetId}
      onTargetType={(t?: AuditTarget) => navigate({ search: { targetType: t } })}
      onClearTarget={() => navigate({ search: (prev) => ({ ...prev, targetId: undefined, page: undefined }) })}
      onPage={(p) => navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })}
    />
  );
}
