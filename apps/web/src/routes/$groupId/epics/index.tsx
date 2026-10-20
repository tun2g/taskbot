import { createFileRoute } from '@tanstack/react-router';

import { EpicsPage } from '@/pages/epics/epics.page';

export const Route = createFileRoute('/$groupId/epics/')({
  component: EpicsPage,
});
