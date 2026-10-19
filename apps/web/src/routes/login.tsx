import { createFileRoute } from '@tanstack/react-router';

import { LoginPage } from '@/pages/login/login.page';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
});
