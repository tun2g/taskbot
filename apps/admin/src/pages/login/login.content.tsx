import type { AdminLoginLinkResponse } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { RequestLinkCard } from './components/request-link-card';
import { WaitingCard } from './components/waiting-card';

function MockLinks() {
  return (
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
  );
}

export function LoginContent({
  sent,
  sending,
  error,
  resendIn,
  expired,
  usedElsewhere,
  sessionExpired,
  mockHint,
  onSend,
}: {
  sent: AdminLoginLinkResponse | null;
  sending: boolean;
  error: string | null;
  resendIn: number;
  expired: boolean;
  usedElsewhere: boolean;
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
            <RequestLinkCard sending={sending} sessionExpired={sessionExpired} onSend={onSend} />
          ) : (
            <WaitingCard
              sent={sent}
              sending={sending}
              resendIn={resendIn}
              expired={expired}
              usedElsewhere={usedElsewhere}
              onSend={onSend}
            />
          )}
          {error && (
            <p role="alert" className="mt-3 text-[15px] text-danger">
              {error}
            </p>
          )}
        </div>
        {mockHint && <MockLinks />}
      </div>
    </div>
  );
}
