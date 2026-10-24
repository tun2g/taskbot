import { createFileRoute } from '@tanstack/react-router';

import { SystemPage } from '@/pages/system/system.page';

export const Route = createFileRoute('/_app/system')({
  component: SystemPage,
});
