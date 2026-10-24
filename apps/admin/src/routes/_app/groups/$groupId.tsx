import { createFileRoute } from '@tanstack/react-router';

import { validateGroupDetailSearch } from '@/lib/search';
import { GroupDetailPage } from '@/pages/group-detail/group-detail.page';

export const Route = createFileRoute('/_app/groups/$groupId')({
  validateSearch: validateGroupDetailSearch,
  component: GroupDetailPage,
});
