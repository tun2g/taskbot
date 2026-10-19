import type { TelegramLoginPayload } from '@tbot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useRouter, useSearch } from '@tanstack/react-router';

import { useTelegramLogin } from '@/api/auth';
import { getErrorMessage } from '@/lib/api-client';
import { safeRedirect, setToken } from '@/lib/auth';
import { config } from '@/lib/runtime-config';
import { isInTelegram } from '@/lib/telegram';

import { LoginContent } from './login.content';

export function LoginContainer() {
  const { redirect } = useSearch({ from: '/login' });
  const router = useRouter();
  const queryClient = useQueryClient();
  const login = useTelegramLogin();
  const target = safeRedirect(redirect);

  // Inside Telegram initData already authenticates us.
  if (isInTelegram()) return <Navigate to="/" replace />;

  const handleAuth = async (payload: TelegramLoginPayload) => {
    try {
      const result = await login.mutateAsync(payload);
      setToken(result.token);
      queryClient.clear();
      router.history.replace(target);
    } catch {
      // error shown from mutation state
    }
  };

  return (
    <LoginContent
      botUsername={config.botUsername}
      onAuth={handleAuth}
      isSigningIn={login.isPending}
      error={login.isError ? getErrorMessage(login.error, 'Sign-in failed.') : null}
    />
  );
}
