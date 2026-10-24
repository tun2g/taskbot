import { createFileRoute } from '@tanstack/react-router';

import { validateRange } from '@/lib/search';
import { UserDetailPage } from '@/pages/user-detail/user-detail.page';

export const Route = createFileRoute('/_app/users/$userId')({
  validateSearch: validateRange,
  component: UserDetailPage,
});
