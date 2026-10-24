import { createFileRoute } from '@tanstack/react-router';

import { validateUsersSearch } from '@/lib/search';
import { UsersPage } from '@/pages/users/users.page';

export const Route = createFileRoute('/_app/users/')({
  validateSearch: validateUsersSearch,
  component: UsersPage,
});
