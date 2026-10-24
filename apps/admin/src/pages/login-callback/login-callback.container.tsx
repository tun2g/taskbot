import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { authKeys, exchangeLoginCode } from '@/api/auth';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';
import { takeRedirect } from '@/lib/redirect';

import { LoginCallbackContent } from './login-callback.content';

const route = getRouteApi('/login/callback');

export function LoginCallbackContainer() {
  const { code } = route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(code ? null : 'This login link is incomplete.');
  // The code works once — never exchange it twice (StrictMode runs effects twice in dev).
  const started = useRef(false);

  useEffect(() => {
    if (!code || started.current) return;
    started.current = true;
    exchangeLoginCode(code)
      .then((session) => {
        queryClient.clear();
        queryClient.setQueryData(authKeys.session, session);
        // Replace history so Back doesn't land on a used link.
        router.history.replace(takeRedirect());
      })
      .catch((e: unknown) => {
        const status = getErrorStatus(e);
        setError(
          status === 401 || status === 400 || status === 404 || status === 410
            ? 'This login link has expired or was already used. Links work once and expire after 5 minutes.'
            : getErrorMessage(e),
        );
      });
  }, [code, queryClient, router]);

  return <LoginCallbackContent error={error} />;
}
