import { createFileRoute } from '@tanstack/react-router';

import { validateAuditSearch } from '@/lib/search';
import { AuditLogPage } from '@/pages/audit-log/audit-log.page';

export const Route = createFileRoute('/_app/audit-log')({
  validateSearch: validateAuditSearch,
  component: AuditLogPage,
});
