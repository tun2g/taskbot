import { Button } from '@/components/ui/button';
import type { IApiToken } from '@/api/tokens';
import { formatRelative } from '@/lib/dates';

import { formatShortDate } from '../snippets';

interface TokenRowProps {
  token: IApiToken;
  onRevoke: (token: IApiToken) => void;
}

export function TokenRow({ token, onRevoke }: TokenRowProps) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span aria-hidden className="tint-link flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg">
        🔑
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-base font-medium text-tg-text">{token.name}</span>
          <code className="shrink-0 font-mono text-xs text-tg-hint">{token.prefix}…</code>
        </div>
        <p className="truncate text-sm text-tg-text">
          <span aria-hidden>{token.group ? '👥 ' : '🌐 '}</span>
          {token.group ? token.group.title : 'All groups'}
        </p>
        <p className="truncate text-xs text-tg-hint">
          Created {formatShortDate(token.createdAt)} ·{' '}
          {token.lastUsedAt ? `Last used ${formatRelative(token.lastUsedAt)}` : 'Never used'}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="-mr-2 text-tg-destructive"
        onClick={() => onRevoke(token)}
        aria-label={`Revoke ${token.name}`}
      >
        Revoke
      </Button>
    </li>
  );
}
