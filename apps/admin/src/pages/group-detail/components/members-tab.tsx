import type { AdminGroupDetail, AdminGroupMemberRow, AdminRange } from '@tbot/shared';
import { useState } from 'react';

import { TextLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { PersonCell, RelativeTime } from '@/components/ui/values';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';

type MemberSort = 'lastActive' | 'events' | 'aiCalls' | 'aiCost' | 'tasks' | 'tokens' | 'joined';

const time = (v: string | null | undefined) => (v ? Date.parse(v) : 0);

const SORTERS: Record<MemberSort, (m: AdminGroupMemberRow) => number> = {
  lastActive: (m) => time(m.lastActiveHereAt !== undefined ? m.lastActiveHereAt : m.lastSeenAt),
  events: (m) => m.events,
  aiCalls: (m) => m.aiCalls,
  aiCost: (m) => m.aiCostUsd,
  tasks: (m) => m.tasksCreated,
  tokens: (m) => m.activeTokens ?? 0,
  joined: (m) => time(m.joinedAt),
};

export function MembersTab({
  group,
  range,
  onOpenPerson,
}: {
  group: AdminGroupDetail;
  range: AdminRange;
  onOpenPerson: (userId: string) => void;
}) {
  const [sort, setSort] = useState<MemberSort>('events');
  const rangeText = RANGE_LABELS[range].toLowerCase();
  const by = SORTERS[sort];
  const members = [...group.members].sort((a, b) => by(b) - by(a) || b.events - a.events || a.person.name.localeCompare(b.person.name));
  // Older APIs only send "last seen anywhere"; then the column says so.
  const hasHere = group.members.some((m) => m.lastActiveHereAt !== undefined);
  const hasTokens = group.members.some((m) => m.activeTokens !== undefined);
  const sortBy = (key: MemberSort) => ({ active: sort === key, onSort: () => setSort(key) });

  return (
    <Card>
      <CardHeader
        title="Members"
        subtitle={`People in this group who have used the bot. Activity, AI and task numbers cover the ${rangeText}. Click a column name to sort, a row to open the person.`}
      />
      {members.length === 0 ? (
        <EmptyState
          title="Nobody in this group has used the bot yet."
          body="People appear here after their first command, button tap or Mini App visit."
        />
      ) : (
        <Table>
          <THead>
            <Th>Person</Th>
            <Th sort={sortBy('joined')}>Joined</Th>
            <Th sort={sortBy('lastActive')} hint={hasHere ? 'in this group' : 'in any group'}>
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
            {hasTokens && (
              <Th align="right" hint="that reach this group" sort={sortBy('tokens')}>
                MCP tokens
              </Th>
            )}
          </THead>
          <tbody>
            {members.map((m) => {
              const userId = m.person.id;
              const aiLink = m.aiCalls > 0 && userId ? { groupId: group.id, userId, range } : null;
              return (
                <Tr key={m.person.telegramUserId} onOpen={userId ? () => onOpenPerson(userId) : undefined}>
                  <Td className="max-w-56">
                    <PersonCell person={m.person} />
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap">{m.joinedAt ? formatDate(m.joinedAt) : <span className="text-text-3">Not recorded</span>}</span>
                  </Td>
                  <Td>
                    {hasHere ? (
                      <>
                        <RelativeTime value={m.lastActiveHereAt} never="Not in 90 days" />
                        {m.lastSeenAt && m.lastSeenAt !== m.lastActiveHereAt && (
                          <span className="block text-xs text-text-3">
                            anywhere: <RelativeTime value={m.lastSeenAt} />
                          </span>
                        )}
                      </>
                    ) : (
                      <RelativeTime value={m.lastSeenAt} />
                    )}
                  </Td>
                  <Td align="right">{formatNumber(m.events)}</Td>
                  <Td align="right" stop>
                    {aiLink ? (
                      <TextLink to="/ai" search={aiLink} title="See this person’s AI calls in this group">
                        {formatNumber(m.aiCalls)}
                      </TextLink>
                    ) : (
                      <span className="text-text-3">0</span>
                    )}
                  </Td>
                  <Td align="right" stop>
                    {aiLink ? (
                      <TextLink to="/ai" search={aiLink} title="See the AI calls behind this cost">
                        {formatMoney(m.aiCostUsd)}
                      </TextLink>
                    ) : (
                      <span className="text-text-3">{formatMoney(m.aiCostUsd)}</span>
                    )}
                  </Td>
                  <Td align="right">{formatNumber(m.tasksCreated)}</Td>
                  {hasTokens && (
                    <Td align="right">
                      {m.activeTokens ? formatNumber(m.activeTokens) : <span className="text-text-3">None</span>}
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
