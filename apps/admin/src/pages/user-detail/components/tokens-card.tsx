import type { AdminUserDetail } from '@tbot/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/states';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { RelativeTime } from '@/components/ui/values';
import { formatDate, plural } from '@/lib/format';

/** This person's MCP tokens, with "Revoke all". */
export function TokensCard({
  name,
  tokens,
  revoking,
  onRevoke,
}: {
  name: string;
  tokens: AdminUserDetail['tokens'];
  revoking: boolean;
  onRevoke: (done: () => void) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Card>
      <CardHeader
        title="MCP tokens"
        subtitle="Personal tokens that let AI clients (Claude, Cursor…) read and change tasks as this person."
        action={
          tokens.length > 0 && (
            <Button variant="danger-outline" size="sm" onClick={() => setConfirm(true)}>
              Revoke all MCP tokens
            </Button>
          )
        }
      />
      {tokens.length === 0 ? (
        <EmptyState
          compact
          title={`${name} has no active MCP tokens.`}
          body="People create tokens themselves in the Mini App → Settings → AI tools."
        />
      ) : (
        <Table>
          <THead>
            <Th>Name</Th>
            <Th hint="first characters, to recognise it">Token</Th>
            <Th>Works in</Th>
            <Th>Last used</Th>
            <Th>Created</Th>
            <Th>Expires</Th>
          </THead>
          <tbody>
            {tokens.map((t) => (
              <Tr key={t.id}>
                <Td className="font-medium text-text">{t.name}</Td>
                <Td>
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-2">{t.prefix}…</code>
                </Td>
                <Td>
                  {t.group ? (
                    <Link
                      to="/groups/$groupId"
                      params={{ groupId: t.group.id }}
                      className="text-accent-text hover:underline"
                    >
                      {t.group.name}
                    </Link>
                  ) : (
                    <span className="text-text-2">All groups</span>
                  )}
                </Td>
                <Td>
                  <RelativeTime value={t.lastUsedAt} never="Never used" />
                </Td>
                <Td className="whitespace-nowrap">{formatDate(t.createdAt)}</Td>
                <Td className="whitespace-nowrap">{t.expiresAt ? formatDate(t.expiresAt) : <span className="text-text-3">Never</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={confirm}
        pending={revoking}
        onCancel={() => setConfirm(false)}
        onConfirm={() => onRevoke(() => setConfirm(false))}
        options={{
          title: `Revoke every MCP token of ${name}?`,
          body: (
            <>
              <p>
                {plural(tokens.length, 'token')} stop working immediately. AI clients using them (Claude, Cursor…) lose
                access until {name} creates a new token in the Mini App.
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
