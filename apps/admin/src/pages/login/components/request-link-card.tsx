import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/states';

/** Step 1: ask the bot for a login link. */
export function RequestLinkCard({
  sending,
  sessionExpired,
  onSend,
}: {
  sending: boolean;
  sessionExpired: boolean;
  onSend: () => void;
}) {
  return (
    <>
      <h1 className="text-lg font-semibold text-text">Log in</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-text-2">
        The bot sends a one-time login link to your Telegram. There’s no password — only the bot owner’s account can log
        in.
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
  );
}
