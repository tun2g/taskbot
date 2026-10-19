import { createFileRoute, redirect } from '@tanstack/react-router';

import { consumeStartParam } from '@/lib/telegram';
import { GroupsPage } from '@/pages/groups/groups.page';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // Mini App deep link: startapp=<groupId>[_<taskId>]
    const start = consumeStartParam();
    if (start?.taskId) {
      throw redirect({
        to: '/$groupId/tasks/$taskId',
        params: { groupId: start.groupId, taskId: start.taskId },
        replace: true,
      });
    }
    if (start) {
      throw redirect({ to: '/$groupId/tasks', params: { groupId: start.groupId }, replace: true });
    }
  },
  component: GroupsPage,
});
