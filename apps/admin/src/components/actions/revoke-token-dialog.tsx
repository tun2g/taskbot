import type { AdminMcpTokenRow } from '@tbot/shared';
import { useEffect, useState } from 'react';

import { ConfirmDialog, type ConfirmOptions } from '@/components/ui/dialog';
import { personName } from '@/lib/format';

function options(token: AdminMcpTokenRow): ConfirmOptions {
  const owner = personName(token.person);
  return {
    title: `Revoke “${token.name}”?`,
    body: (
      <>
        <p>
          The token <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-text">{token.prefix}…</code> of{' '}
          <strong className="font-medium text-text">{owner}</strong> stops working immediately. It works in{' '}
          <strong className="font-medium text-text">{token.group ? token.group.name : 'all their groups'}</strong>; the AI client using it
          (Claude, Cursor…) loses access there.
        </p>
        <p>
          {owner}’s other tokens keep working. This can’t be undone — to reconnect, {owner} creates a new token in the Mini App →
          Settings → AI tools.
        </p>
      </>
    ),
    confirmLabel: 'Revoke this token',
    variant: 'danger',
  };
}

const NONE: ConfirmOptions = { title: '', body: null, confirmLabel: 'Revoke this token', variant: 'danger' };

/** Confirms revoking ONE token: names it, says where it works, and that the person's other tokens keep working. */
export function RevokeTokenDialog({
  token,
  pending,
  onCancel,
  onConfirm,
}: {
  token: AdminMcpTokenRow | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (token: AdminMcpTokenRow) => void;
}) {
  // The dialog stays mounted (its form must exist before it opens) and keeps showing the last token while it closes.
  const [last, setLast] = useState<AdminMcpTokenRow | null>(token);
  useEffect(() => {
    if (token) setLast(token);
  }, [token]);
  const shown = token ?? last;
  return (
    <ConfirmDialog
      open={!!token}
      pending={pending}
      onCancel={onCancel}
      onConfirm={() => token && onConfirm(token)}
      options={shown ? options(shown) : NONE}
    />
  );
}
