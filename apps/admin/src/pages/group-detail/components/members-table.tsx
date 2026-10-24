import type { AdminGroupMemberRow, AdminGroupMemberSort, AdminRange } from '@tbot/shared';

import { TextLink } from '@/components/ui/button';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { PersonCell, RelativeTime } from '@/components/ui/values';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';

/** One page of people; column names sort on the server. */
export function MembersTable({
  rows,
  groupId,
  range,
  sort,
  onSort,
  onOpenPerson,
}: {
  rows: AdminGroupMemberRow[];
  groupId: string;
  range: AdminRange;
  sort: AdminGroupMemberSort;
  onSort: (sort: AdminGroupMemberSort) => void;
  onOpenPerson: (userId: string) => void;
}) {
  const sortBy = (key: AdminGroupMemberSort) => ({ active: sort === key, onSort: () => onSort(key) });
  return (
    <Table>
      <THead>
        <Th>Person</Th>
        <Th sort={sortBy('joined')}>Joined</Th>
        <Th sort={sortBy('lastActive')} hint="in this group">
          Last active
        </Th>
        <Th align="right" hint="requests to the bot" sort={sortBy('events')}>
          Activity
        </Th>
        <Th align="right" sort={sortBy('aiCalls')}>
          AI calls
        </Th>
        <Th align="right" hint="estimated" sort={sortBy('aiCost')}>
          AI cost
        </Th>
        <Th align="right" sort={sortBy('tasks')}>
          Tasks created
        </Th>
        <Th align="right" hint="that reach this group" sort={sortBy('tokens')}>
          MCP tokens
        </Th>
      </THead>
      <tbody>
        {rows.map((m) => {
          const userId = m.person.id;
          const aiLink = m.aiCalls > 0 && userId ? { groupId, userId, range } : null;
          return (
            <Tr key={m.person.telegramUserId} onOpen={userId ? () => onOpenPerson(userId) : undefined}>
              <Td className="max-w-56">
                <PersonCell person={m.person} />
              </Td>
              <Td>
                <span className="whitespace-nowrap">{m.joinedAt ? formatDate(m.joinedAt) : <span className="text-text-3">Not recorded</span>}</span>
              </Td>
              <Td>
                <RelativeTime value={m.lastActiveHereAt} never="Not in 90 days" />
                {m.lastSeenAt && m.lastSeenAt !== m.lastActiveHereAt && (
                  <span className="block text-[13px] text-text-3">
                    anywhere: <RelativeTime value={m.lastSeenAt} />
                  </span>
                )}
              </Td>
              <Td align="right">{formatNumber(m.events)}</Td>
              <Td align="right" stop>
                {aiLink ? (
                  <TextLink to="/ai" search={aiLink}>
                    {formatNumber(m.aiCalls)}
                  </TextLink>
                ) : (
                  <span className="text-text-3">0</span>
                )}
              </Td>
              <Td align="right" stop>
                {aiLink ? (
                  <TextLink to="/ai" search={aiLink}>
                    {formatMoney(m.aiCostUsd)}
                  </TextLink>
                ) : (
                  <span className="text-text-3">{formatMoney(m.aiCostUsd)}</span>
                )}
              </Td>
              <Td align="right">{formatNumber(m.tasksCreated)}</Td>
              <Td align="right">{m.activeTokens ? formatNumber(m.activeTokens) : <span className="text-text-3">None</span>}</Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
