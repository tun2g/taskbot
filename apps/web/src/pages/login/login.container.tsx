import type { TelegramLoginPayload } from '@tbot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useRouter, useSearch } from '@tanstack/react-router';

import { useTelegramLogin } from '@/api/auth';
import { getErrorMessage } from '@/lib/api-client';
import { safeRedirect, setToken } from '@/lib/auth';
import { config } from '@/lib/runtime-config';
import { isInTelegram } from '@/lib/telegram';

import { LoginContent } from './login.content';

if (!config.botUsername) {
  // For whoever deploys it — end users only see "open the board from the bot".
  console.warn('[login] VITE_BOT_USERNAME is not set: browser sign-in is off. Set it in apps/web/.env and rebuild.');
}

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
