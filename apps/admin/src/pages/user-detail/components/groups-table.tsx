import type { AdminPersonTotals, AdminRange, AdminUserGroupRow } from '@tbot/shared';
import { useNavigate } from '@tanstack/react-router';

import { GroupStatusBadge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/button';
import { Table, Td, Th, THead, TotalRow, Tr } from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { ACTIVITY_HINT } from '@/lib/labels';

function GroupName({ row }: { row: AdminUserGroupRow }) {
  if (!row.group) return <span className="text-text-2">No group — private chat, Mini App home or MCP</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className={row.group.deleted ? 'text-text-3' : 'font-medium text-text'}>{row.group.name}</span>
      {!row.group.deleted && <GroupStatusBadge status={row.group.status} />}
      {!row.member && !row.group.deleted && <span className="text-[13px] text-text-3">no longer a member</span>}
    </span>
  );
}

/** Where the person used the bot in the range. Rows (with "No group") add up to the footer, which is the page's totals. */
export function GroupsTable({ rows, totals, userId, range }: { rows: AdminUserGroupRow[]; totals: AdminPersonTotals; userId: string; range: AdminRange }) {
  const navigate = useNavigate();
  return (
    <Table>
      <THead>
        <Th>Group</Th>
        <Th>Joined</Th>
        <Th align="right" hint={ACTIVITY_HINT}>
          Activity
        </Th>
        <Th align="right">AI calls</Th>
        <Th align="right" hint="token counts × your prices">
          Est. AI cost
        </Th>
      </THead>
      <tbody>
        {rows.map((g) => {
          const gid = g.group && !g.group.deleted ? g.group.id : null;
          return (
            <Tr key={g.group?.id ?? 'none'} onOpen={gid ? () => navigate({ to: '/groups/$groupId', params: { groupId: gid }, search: { range } }) : undefined}>
              <Td>
                <GroupName row={g} />
              </Td>
              <Td className="whitespace-nowrap">{g.joinedAt ? formatDate(g.joinedAt) : <span className="text-text-3">—</span>}</Td>
              <Td align="right">{formatNumber(g.events)}</Td>
              <Td align="right">{formatNumber(g.aiCalls)}</Td>
              <Td align="right" stop>
                {g.aiCalls > 0 && g.group ? (
                  <TextLink to="/ai" search={{ userId, groupId: g.group.id, range }}>
                    {formatMoney(g.aiCostUsd)}
                  </TextLink>
                ) : (
                  <span className={g.aiCalls > 0 ? undefined : 'text-text-3'}>{formatMoney(g.aiCostUsd)}</span>
                )}
              </Td>
            </Tr>
          );
        })}
      </tbody>
      <tfoot>
        <TotalRow>
          <Td>Total</Td>
          <Td />
          <Td align="right">{formatNumber(totals.events)}</Td>
          <Td align="right">{formatNumber(totals.aiCalls)}</Td>
          <Td align="right">{formatMoney(totals.aiCostUsd)}</Td>
        </TotalRow>
      </tfoot>
    </Table>
  );
}
