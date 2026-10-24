import type { AdminRange, AdminUserRow } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { AiOverrideBadge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/button';
import { Cost } from '@/components/ui/cost';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { PersonCell, RelativeTime } from '@/components/ui/values';
import { formatNumber } from '@/lib/format';
import { ACTIVITY_HINT, RANGE_LABELS, type UserSort } from '@/lib/labels';

/** A count that opens a section of the person's page ("2" → their MCP tokens). */
function AnchorCount({ id, value, hash, zero = '0' }: { id: string | null; value: number; hash: string; zero?: string }) {
  if (!id || value === 0) return <span className="text-text-3">{zero}</span>;
  return (
    <Link to="/users/$userId" params={{ userId: id }} hash={hash} className="text-accent-text hover:underline">
      {formatNumber(value)}
    </Link>
  );
}

export function UsersTable({
  rows,
  range,
  sort,
  onSort,
  onOpen,
  defaultLabel,
}: {
  rows: AdminUserRow[];
  range: AdminRange;
  sort: UserSort;
  onSort: (sort: UserSort) => void;
  onOpen: (userId: string) => void;
  /** "Default (40/day)" for people without an override. */
  defaultLabel: string;
}) {
  const sortBy = (key: UserSort) => ({ active: sort === key, onSort: () => onSort(key) });
  const period = RANGE_LABELS[range].toLowerCase();
  return (
    <Table>
      <THead>
        <Th>Person</Th>
        <Th align="right" hint="they’ve used the bot in">
          Groups
        </Th>
        <Th sort={sortBy('lastSeen')} hint="anywhere">
          Last seen
        </Th>
        <Th align="right" hint={`${ACTIVITY_HINT} · ${period}`} sort={sortBy('events')}>
          Activity
        </Th>
        <Th align="right" hint={period} sort={sortBy('aiCalls')}>
          AI calls
        </Th>
        <Th align="right" hint={period} sort={sortBy('aiCost')}>
          Est. AI cost
        </Th>
        <Th align="right" hint="active now" sort={sortBy('tokens')}>
          MCP tokens
        </Th>
        <Th hint="your override">AI</Th>
      </THead>
      <tbody>
        {rows.map((u) => {
          const id = u.person.id;
          const ai = id && u.totals.aiCalls > 0 ? { to: '/ai' as const, search: { userId: id, range } } : null;
          return (
            <Tr key={u.person.telegramUserId} onOpen={id ? () => onOpen(id) : undefined}>
              <Td>
                <PersonCell person={u.person} link={false} />
              </Td>
              <Td align="right" stop>
                <AnchorCount id={id} value={u.groups} hash="groups" />
              </Td>
              <Td>
                <RelativeTime value={u.lastSeenAt} />
              </Td>
              <Td align="right">{formatNumber(u.totals.events)}</Td>
              <Td align="right" stop>
                {ai ? <TextLink {...ai}>{formatNumber(u.totals.aiCalls)}</TextLink> : <span className="text-text-3">0</span>}
              </Td>
              <Td align="right" stop>
                {ai ? (
                  <TextLink {...ai}>
                    <Cost usd={u.totals.aiCostUsd} unpriced={u.totals.aiUnpriced} />
                  </TextLink>
                ) : (
                  <Cost usd={u.totals.aiCostUsd} className="text-text-3" />
                )}
              </Td>
              <Td align="right" stop>
                <AnchorCount id={id} value={u.activeTokens} hash="tokens" zero="None" />
              </Td>
              <Td>
                <AiOverrideBadge disabled={u.aiDisabled} dailyLimit={u.aiDailyLimit} defaultLabel={defaultLabel} reason={u.aiReason} />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
