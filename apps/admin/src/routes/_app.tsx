import { createFileRoute, redirect } from '@tanstack/react-router';

import { sessionQuery } from '@/api/auth';
import { AppShell } from '@/components/layout/app-shell';
import { getErrorStatus } from '@/lib/api-client';

/** Everything except /login lives behind the owner's session. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(sessionQuery);
    } catch (error) {
      if (getErrorStatus(error) === 401) {
        throw redirect({ to: '/login', search: { redirect: location.href }, replace: true });
      }
      throw error;
    }
  },
  component: AppShell,
});
