import { createFileRoute } from '@tanstack/react-router';

import { validateGroupsSearch } from '@/lib/search';
import { GroupsPage } from '@/pages/groups/groups.page';

export const Route = createFileRoute('/_app/groups/')({
  validateSearch: validateGroupsSearch,
  component: GroupsPage,
});
