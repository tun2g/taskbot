import type { AdminLoginLinkResponse } from '@tbot/shared';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/states';

function minutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m <= 1 ? '1 minute' : `${m} minutes`;
}

/** Step 2: the link is on its way — which browser it logs in, and what happened to it. */
export function WaitingCard({
  sent,
  sending,
  resendIn,
  expired,
  usedElsewhere,
  onSend,
}: {
  sent: AdminLoginLinkResponse;
  sending: boolean;
  resendIn: number;
  expired: boolean;
  usedElsewhere: boolean;
  onSend: () => void;
}) {
  const cooling = resendIn > 0 && !expired && !usedElsewhere;
  return (
    <>
      <h1 className="text-lg font-semibold text-text">Check your Telegram</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-text-2">
        We sent a link to <strong className="text-text">{sent.sentTo}</strong>. It works once and expires in{' '}
        {minutes(sent.expiresInSeconds)}.
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-text-2">
        The link logs in whichever browser opens it. To log in here, open Telegram on this computer, or copy the link
        into this browser.
      </p>
      {usedElsewhere ? (
        <div className="mt-4">
          <Notice tone="warn">
            That link was used in another browser, so that browser is now logged in — not this one. To log in here, send
            a new link and open it in this browser.
          </Notice>
        </div>
      ) : (
        expired && (
          <div className="mt-4">
            <Notice tone="warn">That link has expired. Send a new one.</Notice>
          </div>
        )
      )}
      <Button className="mt-5 w-full" onClick={onSend} loading={sending} disabled={cooling}>
        {cooling ? `Send another link in ${resendIn}s` : 'Send another link'}
      </Button>
      <p className="mt-3 text-[13px] leading-relaxed text-text-3">
        Didn’t get it? Make sure you’ve started a chat with the bot in Telegram — bots can’t message you first.
      </p>
    </>
  );
}
