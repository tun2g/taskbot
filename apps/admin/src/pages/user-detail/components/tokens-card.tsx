import type { AdminMcpTokenRow } from '@tbot/shared';
import { useState } from 'react';

import { TokenListBody } from '@/components/tokens/token-list-body';
import type { TokenList } from '@/components/tokens/use-token-list';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { plural } from '@/lib/format';

/** This person's active MCP tokens: "Revoke" per token, or "Revoke all". */
export function TokensCard({
  name,
  list,
  onRevokeOne,
  revokingAll,
  onRevokeAll,
}: {
  name: string;
  list: TokenList;
  onRevokeOne: (token: AdminMcpTokenRow) => void;
  revokingAll: boolean;
  onRevokeAll: (done: () => void) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Card>
      <div id="tokens" className="scroll-mt-20" />
      <CardHeader
        title="Active MCP tokens"
        subtitle="Personal tokens that let AI clients (Claude, Cursor…) read and change tasks as this person. Revoke one to cut off a single client."
        action={
          list.total > 1 && (
            <Button variant="danger-outline" size="sm" onClick={() => setConfirm(true)}>
              Revoke all {list.total}
            </Button>
          )
        }
      />
      <TokenListBody
        list={list}
        mode="active"
        onRevoke={onRevokeOne}
        empty={{ title: `${name} has no active MCP tokens.`, body: 'People create tokens themselves in the Mini App → Settings → AI tools.' }}
      />
      <ConfirmDialog
        open={confirm}
        pending={revokingAll}
        onCancel={() => setConfirm(false)}
        onConfirm={() => onRevokeAll(() => setConfirm(false))}
        options={{
          title: `Revoke every MCP token of ${name}?`,
          body: (
            <>
              <p>
                {plural(list.total, 'token')} stop working immediately. AI clients using them (Claude, Cursor…) lose access until {name}{' '}
                creates a new token in the Mini App.
              </p>
              <p>Their tasks and groups are not affected.</p>
            </>
          ),
          confirmLabel: 'Revoke all tokens',
          variant: 'danger',
        }}
      />
    </Card>
  );
}
