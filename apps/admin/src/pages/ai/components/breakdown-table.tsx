import type { AdminAiBreakdownRow, AdminAiUsage } from '@tbot/shared';

import { EmptyState, TableSkeleton } from '@/components/ui/states';
import { Table, Td, Th, THead, TotalRow, Tr } from '@/components/ui/table';
import { formatDay, formatMoney, formatNumber } from '@/lib/format';
import { featureLabel, GROUP_BY_LABELS } from '@/lib/labels';

function RowLabel({ row, groupBy }: { row: AdminAiBreakdownRow; groupBy: AdminAiUsage['groupBy'] }) {
  switch (groupBy) {
    case 'day':
      return <span className="whitespace-nowrap">{formatDay(row.key, { withYear: true })}</span>;
    case 'feature':
      return <span>{featureLabel(row.key)}</span>;
    case 'model':
      return <span className="font-mono text-[13px]">{row.label}</span>;
    case 'group':
      return row.key === 'none' ? <span className="text-text-3">Not in a group (e.g. direct messages)</span> : <span className="font-medium">{row.label}</span>;
    case 'user':
      return row.key === 'none' ? <span className="text-text-3">Unknown person</span> : <span className="font-medium">{row.label}</span>;
  }
}

const drillable = (groupBy: AdminAiUsage['groupBy'], row: AdminAiBreakdownRow) =>
  (groupBy === 'feature' || groupBy === 'group' || groupBy === 'user') && row.key !== 'none';

export function BreakdownTable({
  usage,
  loading,
  groupBy,
  onDrill,
}: {
  usage: AdminAiUsage | undefined;
  loading: boolean;
  groupBy: AdminAiUsage['groupBy'];
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
        <Th align="right">Calls</Th>
        <Th align="right" hint="error or bad reply">
          Failed
        </Th>
        <Th align="right" hint="sent to the model">
          Input tokens
        </Th>
        <Th align="right" hint="written by the model">
          Output tokens
        </Th>
        <Th align="right" hint="estimated">
          Cost
        </Th>
        <Th align="right" hint="model has no price">
          Unpriced
        </Th>
      </THead>
      <tbody>
        {rows.map((row) => {
          const canDrill = drillable(groupBy, row);
          return (
            <Tr key={row.key} onOpen={canDrill ? () => onDrill(row) : undefined}>
              <Td>
                <RowLabel row={row} groupBy={groupBy} />
              </Td>
              <Td align="right">{formatNumber(row.calls)}</Td>
              <Td align="right" className={row.failed > 0 ? 'text-text' : 'text-text-3'}>
                {row.failed > 0 ? formatNumber(row.failed) : '—'}
              </Td>
              <Td align="right">{formatNumber(row.inputTokens)}</Td>
              <Td align="right">{formatNumber(row.outputTokens)}</Td>
              <Td align="right" className="font-medium">
                {formatMoney(row.costUsd)}
                {row.unpriced > 0 && <span title="Some calls have no price, so this is a lower bound."> +</span>}
              </Td>
              <Td align="right" className={row.unpriced > 0 ? 'text-warn' : 'text-text-3'}>
                {row.unpriced > 0 ? formatNumber(row.unpriced) : '—'}
              </Td>
            </Tr>
          );
        })}
      </tbody>
      <tfoot>
        <TotalRow>
          <Td>Total</Td>
          <Td align="right">{formatNumber(t.calls)}</Td>
          <Td align="right">{t.failed > 0 ? formatNumber(t.failed) : '—'}</Td>
          <Td align="right">{formatNumber(t.inputTokens)}</Td>
          <Td align="right">{formatNumber(t.outputTokens)}</Td>
          <Td align="right">{formatMoney(t.costUsd)}</Td>
          <Td align="right" className={t.unpriced > 0 ? 'text-warn' : 'text-text-3'}>
            {t.unpriced > 0 ? formatNumber(t.unpriced) : '—'}
          </Td>
        </TotalRow>
      </tfoot>
    </Table>
  );
}
