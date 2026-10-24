import type { AdminAiBreakdownRow, AdminPersonTotals, AdminRange } from '@tbot/shared';
import { AI_FEATURE_VALUES, type AiFeature } from '@tbot/shared';
import { useNavigate } from '@tanstack/react-router';

import { Cost } from '@/components/ui/cost';
import { Table, Td, Th, THead, TotalRow, Tr } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import { featureLabel } from '@/lib/labels';

/** AI use by feature for one person; each row opens the calls behind it. The footer is the person's totals (rows add up to it). */
export function AiFeatureTable({
  rows,
  totals,
  userId,
  range,
}: {
  rows: AdminAiBreakdownRow[];
  totals: AdminPersonTotals;
  userId: string;
  range: AdminRange;
}) {
  const navigate = useNavigate();
  const open = (feature?: string) =>
    navigate({
      to: '/ai',
      search: { userId, range, feature: AI_FEATURE_VALUES.includes(feature as AiFeature) ? (feature as AiFeature) : undefined },
    });

  return (
    <Table>
      <THead>
        <Th>Feature</Th>
        <Th align="right">AI calls</Th>
        <Th align="right" hint="error or unusable reply">
          Failed
        </Th>
        <Th align="right" hint="token counts × your prices">
          Est. AI cost
        </Th>
      </THead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.key} onOpen={() => open(r.key)}>
            <Td className="font-medium text-text">{featureLabel(r.key)}</Td>
            <Td align="right">{formatNumber(r.calls)}</Td>
            <Td align="right">{r.failed > 0 ? formatNumber(r.failed) : <span className="text-text-3">0</span>}</Td>
            <Td align="right">
              <Cost usd={r.costUsd} unpriced={r.unpriced} />
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
          <Td align="right">{formatNumber(totals.aiCalls)}</Td>
          <Td align="right">{formatNumber(totals.aiFailed)}</Td>
          <Td align="right">
            <Cost usd={totals.aiCostUsd} unpriced={totals.aiUnpriced} />
          </Td>
        </TotalRow>
      </tfoot>
    </Table>
  );
}
