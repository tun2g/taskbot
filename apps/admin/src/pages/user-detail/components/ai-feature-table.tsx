import type { AdminAiBreakdownRow, AdminRange } from '@tbot/shared';
import { AI_FEATURE_VALUES, type AiFeature } from '@tbot/shared';
import { useNavigate } from '@tanstack/react-router';

import { Notice } from '@/components/ui/states';
import { Table, Td, Th, THead, TotalRow, Tr } from '@/components/ui/table';
import { formatMoney, formatNumber, plural } from '@/lib/format';
import { featureLabel } from '@/lib/labels';

/** AI use by feature for one person; each row opens the calls behind it on the AI page. */
export function AiFeatureTable({
  rows,
  userId,
  range,
}: {
  rows: AdminAiBreakdownRow[];
  userId: string;
  range: AdminRange;
}) {
  const navigate = useNavigate();
  const total = rows.reduce(
    (t, r) => ({ calls: t.calls + r.calls, failed: t.failed + r.failed, costUsd: t.costUsd + r.costUsd, unpriced: t.unpriced + r.unpriced }),
    { calls: 0, failed: 0, costUsd: 0, unpriced: 0 },
  );
  const open = (feature?: string) =>
    navigate({
      to: '/ai',
      search: {
        userId,
        range,
        feature: AI_FEATURE_VALUES.includes(feature as AiFeature) ? (feature as AiFeature) : undefined,
      },
    });

  return (
    <>
      {total.unpriced > 0 && (
        <div className="px-4 pb-3">
          <Notice tone="warn">
            {plural(total.unpriced, 'call')} used a model with no price in your price table, so the cost shown is a
            lower bound. Add the model’s price in Settings — new calls are priced from then on; calls already made keep the cost they were recorded with.
          </Notice>
        </div>
      )}
      <Table>
        <THead>
          <Th>Feature</Th>
          <Th align="right">Calls</Th>
          <Th align="right" hint="errors, unusable replies, limits">
            Not successful
          </Th>
          <Th align="right" hint="estimated">
            Cost
          </Th>
        </THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.key} onOpen={() => open(r.key)}>
              <Td className="font-medium text-text">{featureLabel(r.key)}</Td>
              <Td align="right">{formatNumber(r.calls)}</Td>
              <Td align="right">{r.failed > 0 ? formatNumber(r.failed) : <span className="text-text-3">0</span>}</Td>
              <Td align="right">
                {formatMoney(r.costUsd)}
                {r.unpriced > 0 && (
                  <span className="ml-1 text-xs text-warn" title={`${plural(r.unpriced, 'call')} had no price`}>
                    +?
                  </span>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td>
              <button type="button" className="cursor-pointer text-accent-text hover:underline" onClick={() => open()}>
                Total — see every call
              </button>
            </Td>
            <Td align="right">{formatNumber(total.calls)}</Td>
            <Td align="right">{formatNumber(total.failed)}</Td>
            <Td align="right">{formatMoney(total.costUsd)}</Td>
          </TotalRow>
        </tfoot>
      </Table>
    </>
  );
}
