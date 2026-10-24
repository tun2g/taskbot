import { createFileRoute } from '@tanstack/react-router';

import { validateRange } from '@/lib/search';
import { OverviewPage } from '@/pages/overview/overview.page';

export const Route = createFileRoute('/_app/')({
  validateSearch: validateRange,
  component: OverviewPage,
});
