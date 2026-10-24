import type { AdminMcpTokenRow } from '@tbot/shared';
import { useState } from 'react';

import { useRevokeToken } from '@/api/mcp';
import { RevokeTokenDialog } from '@/components/actions/revoke-token-dialog';

/** "Revoke" on one token row: `ask(token)` opens the confirmation; render `dialog` once on the page. */
export function useRevokeTokenFlow() {
  const [target, setTarget] = useState<AdminMcpTokenRow | null>(null);
  const revoke = useRevokeToken();
  const dialog = (
    <RevokeTokenDialog
      token={target}
      pending={revoke.isPending}
      onCancel={() => setTarget(null)}
      onConfirm={(t) => revoke.mutate(t, { onSettled: () => setTarget(null) })}
    />
  );
  return { ask: setTarget, dialog };
}
