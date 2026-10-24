import type { AdminMcpOverview } from '@tbot/shared';

import { GroupStatusBadge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';

import { Failures } from './failures';

export function ByGroupCard({ rows, onOpen }: { rows: NonNullable<AdminMcpOverview['byGroup']>; onOpen: (groupId: string) => void }) {
  return (
    <Card>
      <CardHeader title="By group" subtitle="Which group’s tasks the calls read or changed. Click to open the group." />
      {rows.length === 0 ? (
        <EmptyState compact title="No calls were tied to a group." body="Calls like “List groups” don’t belong to one group." />
      ) : (
        <Table>
          <THead>
            <Th>Group</Th>
            <Th align="right">Calls</Th>
            <Th align="right">Failed</Th>
          </THead>
          <tbody>
            {rows.map((g) => (
              <Tr key={g.group.id} onOpen={g.group.deleted ? undefined : () => onOpen(g.group.id)}>
                <Td>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={cn('font-medium', g.group.deleted ? 'text-text-3' : 'text-text')}>{g.group.name}</span>
                    {!g.group.deleted && <GroupStatusBadge status={g.group.status} />}
                  </span>
                </Td>
                <Td align="right">{formatNumber(g.calls)}</Td>
                <Td align="right">
                  <Failures failed={g.failed} calls={g.calls} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
