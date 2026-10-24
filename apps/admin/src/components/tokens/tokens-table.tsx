import type { AdminMcpTokenRow } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { PersonCell, RelativeTime } from '@/components/ui/values';
import { formatDate } from '@/lib/format';

function WorksIn({ token }: { token: AdminMcpTokenRow }) {
  if (!token.group) return <span className="text-text-2">All their groups</span>;
  if (token.group.deleted) return <span className="text-text-3">{token.group.name}</span>;
  return (
    <Link to="/groups/$groupId" params={{ groupId: token.group.id }} className="text-accent-text hover:underline">
      {token.group.name}
    </Link>
  );
}

function Ended({ token }: { token: AdminMcpTokenRow }) {
  if (token.status === 'revoked') {
    return (
      <span className="flex flex-col items-start gap-1">
        <Badge tone="danger">Revoked</Badge>
        <span className="text-[13px] text-text-3">{formatDate(token.revokedAt)}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge tone="neutral">Expired</Badge>
      <span className="text-[13px] text-text-3">{formatDate(token.expiresAt)}</span>
    </span>
  );
}

/**
 * MCP tokens. `active` rows end with a per-row "Revoke"; `history` rows say when the token was revoked or expired.
 * `showOwner` adds the person column (the MCP page; a person's page already knows whose they are).
 */
export function TokensTable({
  tokens,
  mode,
  showOwner = false,
  onRevoke,
  onOpenOwner,
}: {
  tokens: AdminMcpTokenRow[];
  mode: 'active' | 'history';
  showOwner?: boolean;
  onRevoke?: (token: AdminMcpTokenRow) => void;
  onOpenOwner?: (token: AdminMcpTokenRow) => void;
}) {
  return (
    <Table>
      <THead>
        <Th hint="first characters, to recognise it">Token</Th>
        {showOwner && <Th>Owner</Th>}
        <Th>Works in</Th>
        <Th>Last used</Th>
        <Th>Created</Th>
        {mode === 'active' ? <Th>Expires</Th> : <Th>Ended</Th>}
        {mode === 'active' && onRevoke && <Th className="sr-only">Actions</Th>}
      </THead>
      <tbody>
        {tokens.map((t) => (
          <Tr key={t.id} onOpen={showOwner && t.person?.id && onOpenOwner ? () => onOpenOwner(t) : undefined}>
            <Td>
              <div className="font-medium text-text">{t.name}</div>
              <code className="font-mono text-[13px] text-text-3">{t.prefix}…</code>
            </Td>
            {showOwner && (
              <Td className="max-w-48">
                <PersonCell person={t.person} />
              </Td>
            )}
            <Td stop>
              <WorksIn token={t} />
            </Td>
            <Td>
              <RelativeTime value={t.lastUsedAt} never="Never used" />
            </Td>
            <Td className="whitespace-nowrap">{formatDate(t.createdAt)}</Td>
            <Td className="whitespace-nowrap">
              {mode === 'history' ? <Ended token={t} /> : t.expiresAt ? formatDate(t.expiresAt) : <span className="text-text-3">Never</span>}
            </Td>
            {mode === 'active' && onRevoke && (
              <Td align="right" stop>
                <Button size="sm" variant="danger-outline" onClick={() => onRevoke(t)}>
                  Revoke
                </Button>
              </Td>
            )}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
