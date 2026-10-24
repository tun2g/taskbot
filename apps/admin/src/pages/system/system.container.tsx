import { useSystemStatus } from '@/api/system';
import { getErrorMessage } from '@/lib/api-client';

import { SystemContent } from './system.content';

export function SystemContainer() {
  const status = useSystemStatus();
  return (
    <SystemContent
      data={status.data}
      isLoading={status.isLoading}
      error={status.isError ? getErrorMessage(status.error) : null}
      onRetry={() => status.refetch()}
      retrying={status.isFetching}
      updatedAt={status.dataUpdatedAt}
    />
  );
}
