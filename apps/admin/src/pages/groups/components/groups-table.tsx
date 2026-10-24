import type { AdminGroupRef, AdminGroupRow, AdminRange } from '@tbot/shared';

import { type GroupLifecycleAction, GroupRowActions } from '@/components/actions/group-actions';
import { Badge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/button';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { RelativeTime } from '@/components/ui/values';
import { formatDate, formatNumber, personName, plural } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';

import { AiCostCell } from './ai-cost-cell';
import { StatusCell } from './status-cell';

export function GroupsTable({
  rows,
  period,
  onOpen,
  onAction,
  busyId,
}: {
  rows: AdminGroupRow[];
  /** The "had activity in" filter: the period columns and AI cost cover it. */
  period: AdminRange | undefined;
  onOpen: (groupId: string) => void;
  onAction: (action: GroupLifecycleAction, group: AdminGroupRef) => void;
  busyId: string | undefined;
}) {
  return (
    <Table>
      <THead>
        <Th>Group</Th>
        <Th>Status</Th>
        <Th align="right" hint="used bot / in chat" hintWidth="fit">
          Members
        </Th>
        <Th align="right" hint="open / total" hintWidth="fit">
          Tasks
        </Th>
        {period && (
          <Th align="right" hint="requests · tasks created" hintWidth="wrap">
            In the period
          </Th>
        )}
        <Th>Last activity</Th>
        <Th align="right" hint={period ? RANGE_LABELS[period].toLowerCase() : 'last 30 days'} hintWidth="fit">
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
            <Td className="max-w-48 min-w-36">
              <StatusCell group={g} />
            </Td>
            <Td align="right">
              <span className="text-text">{formatNumber(g.knownMembers)}</span>
              {g.memberCount == null ? (
                <Tooltip content="Chat size unknown — Telegram didn’t report it (the bot may not be in the chat).">
                  <span className="text-text-3">&nbsp;/ —</span>
                </Tooltip>
              ) : (
                <span className="text-text-3"> / {formatNumber(g.memberCount)}</span>
              )}
            </Td>
            <Td align="right">
              <span className="text-text">{formatNumber(g.openTasks)}</span>
              <span className="text-text-3"> / {formatNumber(g.tasks)}</span>
            </Td>
            {period && (
              <Td align="right" stop>
                <span className="block text-text">{formatNumber(g.inPeriod?.events ?? 0)}</span>
                <TextLink to="/groups/$groupId" params={{ groupId: g.id }} search={{ tab: 'tasks', view: 'all', createdIn: period }}>
                  {plural(g.inPeriod?.tasksCreated ?? 0, 'task')}
                </TextLink>
              </Td>
            )}
            <Td>
              <RelativeTime value={g.lastActivityAt} never="No activity yet" />
            </Td>
            <Td align="right" stop>
              <AiCostCell group={g} period={period} />
            </Td>
            <Td align="right" stop className="pl-1.5">
              <GroupRowActions group={g} onAction={onAction} busy={busyId === g.id} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
