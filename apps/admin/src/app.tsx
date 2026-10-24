import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';

import { NotFound, RouteError } from './components/layout/route-error';
import { getErrorStatus, setUnauthorizedHandler } from './lib/api-client';
import { parseSearch, stringifySearch } from './lib/search-params';
import { routeTree } from './routeTree.gen';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      // Don't retry client errors (401/404/409) — show them right away.
      retry: (failureCount, error) => {
        const status = getErrorStatus(error);
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
    },
  },
});

export const router = createRouter({
  routeTree,
  context: { queryClient },
  parseSearch,
  stringifySearch,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFound,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Session expired / logged out elsewhere → back to /login, then return here after logging in.
let redirecting = false;
setUnauthorizedHandler(() => {
  const { pathname, searchStr } = router.state.location;
  if (redirecting || pathname.startsWith('/login')) return;
  redirecting = true;
  queryClient.clear();
  void router
    .navigate({ to: '/login', search: { redirect: `${pathname}${searchStr}` }, replace: true })
    .finally(() => {
      redirecting = false;
    });
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
