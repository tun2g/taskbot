import { createFileRoute } from '@tanstack/react-router';

import { validateTaskSearch } from '@/pages/task-detail/task-search';
import { TaskDetailPage } from '@/pages/task-detail/task-detail.page';

export const Route = createFileRoute('/$groupId/tasks/$taskId')({
  validateSearch: validateTaskSearch,
  component: TaskDetailPage,
});
