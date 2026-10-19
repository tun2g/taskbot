import type { TelegramLoginPayload } from '@tbot/shared';

import { TelegramLoginButton } from './components/telegram-login-button';

interface LoginContentProps {
  botUsername?: string;
  onAuth: (payload: TelegramLoginPayload) => void;
  isSigningIn: boolean;
  error: string | null;
}

export function LoginContent({ botUsername, onAuth, isSigningIn, error }: LoginContentProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-tg-bg px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-tg-separator bg-tg-section p-6 text-center shadow-sm">
        <div className="text-4xl" aria-hidden>📋</div>
        <h1 className="mt-3 text-xl font-semibold text-tg-text">TBot task boards</h1>
        <p className="mt-2 text-sm text-tg-hint">Sign in with Telegram to see your groups' task boards.</p>

        <div className="mt-6">
          {botUsername ? (
            isSigningIn ? (
              <p className="flex min-h-12 items-center justify-center text-sm text-tg-hint">Signing you in…</p>
            ) : (
              <TelegramLoginButton botUsername={botUsername.replace(/^@/, '')} onAuth={onAuth} />
            )
          ) : (
            <div className="tint-link rounded-xl p-3 text-left text-sm">
              <p className="font-semibold">Login isn't configured</p>
              <p className="mt-1">
                Set <code>VITE_BOT_USERNAME</code> (the bot's username, without @) in <code>apps/web/.env</code> and
                rebuild the web app.
              </p>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 tint-danger rounded-xl p-3 text-sm">
            {error}
          </p>
        )}

        <p className="mt-6 text-xs text-tg-hint">
          You'll only see groups where you're a member and the bot is installed. Inside Telegram, open the bot's Mini App
          instead — no sign-in needed.
        </p>
      </div>
    </div>
  );
}
