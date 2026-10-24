import type { AdminLoginLinkResponse } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/states';

function minutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m <= 1 ? '1 minute' : `${m} minutes`;
}

export function LoginContent({
  sent,
  sending,
  error,
  resendIn,
  expired,
  sessionExpired,
  mockHint,
  onSend,
}: {
  sent: AdminLoginLinkResponse | null;
  sending: boolean;
  error: string | null;
  resendIn: number;
  expired: boolean;
  sessionExpired: boolean;
  mockHint: boolean;
  onSend: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <p className="text-base font-semibold text-text">TaskBot admin</p>
            <p className="text-[13px] text-text-3">For the bot owner only</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6">
          {!sent ? (
            <>
              <h1 className="text-lg font-semibold text-text">Log in</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-text-2">
                The bot sends a one-time login link to your Telegram. There’s no password — only the bot owner’s
                account can log in.
              </p>
              {sessionExpired && (
                <div className="mt-4">
                  <Notice>Your session ended. Log in again to continue where you were.</Notice>
                </div>
              )}
              <Button variant="primary" className="mt-5 w-full" onClick={onSend} loading={sending}>
                Send login link to my Telegram
              </Button>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-text">Check your Telegram</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-text-2">
                We sent a link to <strong className="text-text">{sent.sentTo}</strong>. It expires in{' '}
                {minutes(sent.expiresInSeconds)}. Open it on this device to log in.
              </p>
              {expired && (
                <div className="mt-4">
                  <Notice tone="warn">That link has expired. Send a new one.</Notice>
                </div>
              )}
              <Button className="mt-5 w-full" onClick={onSend} loading={sending} disabled={resendIn > 0 && !expired}>
                {resendIn > 0 && !expired ? `Send another link in ${resendIn}s` : 'Send another link'}
              </Button>
              <p className="mt-3 text-[13px] leading-relaxed text-text-3">
                Didn’t get it? Make sure you’ve started a chat with the bot in Telegram — bots can’t message you first.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        {mockHint && (
          <p className="mt-4 text-center text-[13px] text-text-3">
            Mock mode:{' '}
            <Link to="/login/callback" search={{ code: 'demo' }} className="text-accent-text underline">
              open the login link
            </Link>{' '}
            ·{' '}
            <Link to="/login/callback" search={{ code: 'expired' }} className="text-accent-text underline">
              try an expired link
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
