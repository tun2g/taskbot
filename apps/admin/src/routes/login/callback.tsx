import { createFileRoute } from '@tanstack/react-router';

import { validateCallbackSearch } from '@/lib/search';
import { LoginCallbackPage } from '@/pages/login-callback/login-callback.page';

export const Route = createFileRoute('/login/callback')({
  validateSearch: validateCallbackSearch,
  component: LoginCallbackPage,
});
