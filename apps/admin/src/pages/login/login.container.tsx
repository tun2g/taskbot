import type { AdminLoginLinkResponse } from '@tbot/shared';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useRequestLoginLink } from '@/api/auth';
import { getErrorMessage, getErrorStatus, isMockMode } from '@/lib/api-client';
import { storeRedirect } from '@/lib/redirect';

import { LoginContent } from './login.content';

const route = getRouteApi('/login/');
const RESEND_COOLDOWN_SECONDS = 30;

export function LoginContainer() {
  const { redirect } = route.useSearch();
  const request = useRequestLoginLink();
  const [sent, setSent] = useState<(AdminLoginLinkResponse & { sentAt: number }) | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sent) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sent]);

  const send = () => {
    // Remember where to go: the link usually opens in a new tab.
    storeRedirect(redirect);
    request.mutate(undefined, {
      onSuccess: (data) => {
        setSent({ ...data, sentAt: Date.now() });
        setNow(Date.now());
      },
    });
  };

  const elapsed = sent ? Math.floor((now - sent.sentAt) / 1000) : 0;
  const status = getErrorStatus(request.error);

  return (
    <LoginContent
      sent={sent}
      sending={request.isPending}
      error={
        request.isError
          ? status === 429
            ? 'Too many login links requested. Wait a minute and try again.'
            : getErrorMessage(request.error)
          : null
      }
      resendIn={sent ? Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed) : 0}
      expired={!!sent && elapsed >= sent.expiresInSeconds}
      sessionExpired={!!redirect}
      mockHint={isMockMode}
      onSend={send}
    />
  );
}
