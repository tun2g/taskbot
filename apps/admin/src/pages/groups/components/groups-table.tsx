import type { AdminGroupRef, AdminGroupRow } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { type GroupLifecycleAction, GroupRowActions } from '@/components/actions/group-actions';
import { Badge, GroupStatusBadge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/button';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { RelativeTime } from '@/components/ui/values';
import { formatDate, formatMoney, formatNumber, personName, plural, previousDecisionText } from '@/lib/format';

export function GroupsTable({
  rows,
  onOpen,
  onAction,
  busyId,
}: {
  rows: AdminGroupRow[];
  onOpen: (groupId: string) => void;
  onAction: (action: GroupLifecycleAction, group: AdminGroupRef) => void;
  busyId: string | undefined;
}) {
  const period = rows.some((r) => r.inPeriod);
  return (
    <Table>
      <THead>
        <Th>Group</Th>
        <Th>Status</Th>
        <Th align="right" hint="used the bot / in the chat">
          Members
        </Th>
        <Th align="right" hint="open / total">
          Tasks
        </Th>
        {period && (
          <Th align="right" hint="requests · tasks created">
            In the period
          </Th>
        )}
        <Th>Last activity</Th>
        <Th align="right" hint="last 30 days">
          AI cost
        </Th>
        <Th>
          <span className="sr-only">Actions</span>
        </Th>
      </THead>
      <tbody>
        {rows.map((g) => (
          <Tr key={g.id} onOpen={() => onOpen(g.id)}>
            <Td className="max-w-64">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-text">{g.name}</span>
                {g.isForum && (
                  <Badge dot={false} title="A Telegram group with topics; tasks can belong to a topic.">
                    Forum
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-text-3">
                Added {formatDate(g.addedAt ?? g.createdAt)}
                {g.addedBy && <> by {personName(g.addedBy)}</>}
              </span>
            </Td>
            <Td className="max-w-44">
              <GroupStatusBadge status={g.status} />
              {g.previousDecision && (
                <span className="mt-1 block truncate text-[13px] text-warn" title={previousDecisionText(g.previousDecision)}>
                  {previousDecisionText(g.previousDecision)}
                </span>
              )}
              {g.statusReason && (g.status === GroupStatus.REJECTED || g.status === GroupStatus.SUSPENDED) && (
                <span className="mt-1 block truncate text-[13px] text-text-3" title={g.statusReason}>
                  Reason: {g.statusReason}
                </span>
              )}
            </Td>
            <Td align="right">
              <span className="text-text">{formatNumber(g.knownMembers)}</span>
              {g.memberCount == null ? (
                <span className="text-text-3" title="Chat size unknown — Telegram didn’t report it (the bot may not be in the chat).">
                  {' '}
                  / —
                </span>
              ) : (
                <span className="text-text-3"> / {formatNumber(g.memberCount)}</span>
              )}
            </Td>
            <Td align="right">
              <span className="text-text">{formatNumber(g.openTasks)}</span>
              <span className="text-text-3"> / {formatNumber(g.tasks)}</span>
            </Td>
            {period && (
              <Td align="right" className="whitespace-nowrap">
                <span className="text-text">{formatNumber(g.inPeriod?.events ?? 0)}</span>
                <span className="text-text-3"> · {plural(g.inPeriod?.tasksCreated ?? 0, 'task')}</span>
              </Td>
            )}
            <Td>
              <RelativeTime value={g.lastActivityAt} never="No activity yet" />
            </Td>
            <Td align="right" stop>
              {g.aiCostUsd30d > 0 || g.aiCalls30d > 0 ? (
                <TextLink
                  to="/ai"
                  search={{ groupId: g.id, range: '30d' }}
                  title={`${formatNumber(g.aiCalls30d)} AI calls in the last 30 days — see each one`}
                >
                  {formatMoney(g.aiCostUsd30d)}
                </TextLink>
              ) : (
                <span className="text-text-3">$0</span>
              )}
            </Td>
            <Td align="right" stop>
              <GroupRowActions group={g} onAction={onAction} busy={busyId === g.id} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
