import type { AdminAiBreakdownRow, AdminAiUsage, AdminRange } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { Cost } from '@/components/ui/cost';
import { EmptyState, TableSkeleton } from '@/components/ui/states';
import { Table, Td, Th, THead, TotalRow, Tr } from '@/components/ui/table';
import { formatDay, formatNumber } from '@/lib/format';
import { featureLabel, GROUP_BY_LABELS } from '@/lib/labels';

const linkCls = 'font-medium text-text underline-offset-2 hover:text-accent-text hover:underline';

function RowLabel({ row, groupBy, range }: { row: AdminAiBreakdownRow; groupBy: AdminAiUsage['groupBy']; range: AdminRange }) {
  switch (groupBy) {
    case 'day':
      return <span className="whitespace-nowrap">{formatDay(row.key, { withYear: true })}</span>;
    case 'feature':
      return <span>{featureLabel(row.key)}</span>;
    case 'model':
      return <span className="font-mono text-sm">{row.label}</span>;
    case 'group':
      return row.key === 'none' ? <span className="text-text-2">No group — private chat, Mini App home or MCP</span> : <span className="font-medium">{row.label}</span>;
    case 'user':
      return row.key === 'none' ? (
        <span className="text-text-3">No person</span>
      ) : (
        <Link to="/users/$userId" params={{ userId: row.key }} search={{ range }} className={linkCls} onClick={(e) => e.stopPropagation()}>
          {row.label}
        </Link>
      );
  }
}

const drillable = (groupBy: AdminAiUsage['groupBy'], row: AdminAiBreakdownRow) =>
  (groupBy === 'feature' || groupBy === 'group' || groupBy === 'user') && row.key !== 'none';

export function BreakdownTable({
  usage,
  loading,
  groupBy,
  range,
  onDrill,
}: {
  usage: AdminAiUsage | undefined;
  loading: boolean;
  groupBy: AdminAiUsage['groupBy'];
  range: AdminRange;
  onDrill: (row: AdminAiBreakdownRow) => void;
}) {
  if (loading || !usage) return <TableSkeleton rows={5} />;
  // Day rows include empty days (so the chart has every day); the table only lists days with calls.
  const rows = groupBy === 'day' ? [...usage.rows].filter((r) => r.calls > 0).reverse() : usage.rows;
  if (rows.length === 0) {
    return <EmptyState compact title="No AI calls in this period." body="When people use AI features, their calls and estimated cost show up here." />;
  }
  const t = usage.totals;
  return (
    <Table>
      <THead>
        <Th>{GROUP_BY_LABELS[groupBy]}</Th>
        <Th align="right">AI calls</Th>
        <Th align="right" hint="error or unusable reply">
          Failed
        </Th>
        <Th align="right" hint="sent to the model">
          Input tokens
        </Th>
        <Th align="right" hint="written by the model">
          Output tokens
        </Th>
        <Th align="right" hint="token counts × your prices">
          Est. AI cost
        </Th>
      </THead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.key} onOpen={drillable(groupBy, row) ? () => onDrill(row) : undefined}>
            <Td>
              <RowLabel row={row} groupBy={groupBy} range={range} />
            </Td>
            <Td align="right">{formatNumber(row.calls)}</Td>
            <Td align="right" className={row.failed > 0 ? 'text-text' : 'text-text-3'}>
              {row.failed > 0 ? formatNumber(row.failed) : '—'}
            </Td>
            <Td align="right">{formatNumber(row.inputTokens)}</Td>
            <Td align="right">{formatNumber(row.outputTokens)}</Td>
            <Td align="right" className="font-medium">
              <Cost usd={row.costUsd} unpriced={row.unpriced} />
            </Td>
          </Tr>
        ))}
      </tbody>
      <tfoot>
        <TotalRow>
          <Td>Total</Td>
          <Td align="right">{formatNumber(t.calls)}</Td>
          <Td align="right">{t.failed > 0 ? formatNumber(t.failed) : '—'}</Td>
          <Td align="right">{formatNumber(t.inputTokens)}</Td>
          <Td align="right">{formatNumber(t.outputTokens)}</Td>
          <Td align="right">
            <Cost usd={t.costUsd} unpriced={t.unpriced} />
          </Td>
        </TotalRow>
      </tfoot>
    </Table>
  );
}
