import { createFileRoute } from '@tanstack/react-router';

import { validateBoardSearch } from '@/pages/tasks/board-search';
import { TasksPage } from '@/pages/tasks/tasks.page';

export const Route = createFileRoute('/$groupId/tasks/')({
  validateSearch: validateBoardSearch,
  component: TasksPage,
});
