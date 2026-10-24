import { createFileRoute } from '@tanstack/react-router';

import { validateLoginSearch } from '@/lib/search';
import { LoginPage } from '@/pages/login/login.page';

export const Route = createFileRoute('/login/')({
  validateSearch: validateLoginSearch,
  component: LoginPage,
});
