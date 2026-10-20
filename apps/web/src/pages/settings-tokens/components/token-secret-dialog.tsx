import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SectionHeading } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useCopy } from '../use-copy';
import { SetupSnippets } from './setup-snippets';

interface TokenSecretDialogProps {
  name: string;
  /** Group title, or null for an all-groups token. */
  scope: string | null;
  secret: string;
  /** null while /mcp-info is loading or failed — the snippets are hidden then. */
  mcpUrl: string | null | undefined;
  onDone: () => void;
}

/**
 * Shows a freshly created token's secret — the only time it's ever visible. Backdrop, Esc and
 * Telegram's BackButton don't close it; only "I've copied it" does.
 */
export function TokenSecretDialog({ name, scope, secret, mcpUrl, onDone }: TokenSecretDialogProps) {
  const copy = useCopy();
  return (
    <Dialog
      title={scope ? `Token for ${scope}` : 'Token for all your groups'}
      description={`“${name}” created.`}
      dismissible={false}
      hideClose
      onClose={onDone}
      footer={
        <Button variant="primary" onClick={onDone} className="sm:min-w-40">
          I've copied it
        </Button>
      }
    >
      <p role="note" className="tint-danger mb-4 flex gap-2 rounded-xl p-3 text-sm font-medium">
        <span aria-hidden>⚠️</span>
        <span>You won't see this token again. Treat it like a password.</span>
      </p>

      <SectionHeading>Your token</SectionHeading>
      <div className="mb-5 flex items-center gap-2 rounded-lg bg-tg-secondary p-2 pl-3">
        <code className="min-w-0 flex-1 select-all font-mono text-sm text-tg-text [overflow-wrap:anywhere]">
          {secret}
        </code>
        <Button size="sm" variant="primary" onClick={() => copy(secret)} aria-label="Copy token">
          Copy
        </Button>
      </div>

      <SectionHeading>Connect with this token</SectionHeading>
      {mcpUrl ? (
        <SetupSnippets url={mcpUrl} token={secret} />
      ) : mcpUrl === undefined ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : (
        <p className="text-sm text-tg-hint">Copy the token above, then use the setup steps on the page.</p>
      )}
    </Dialog>
  );
}
