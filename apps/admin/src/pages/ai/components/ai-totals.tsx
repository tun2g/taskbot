import type { AdminAiUsage, AdminRange } from '@tbot/shared';

import { KpiCard } from '@/components/ui/kpi';
import { Skeleton } from '@/components/ui/states';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';

export function AiTotals({
  totals,
  loading,
  range,
}: {
  totals: AdminAiUsage['totals'] | undefined;
  loading: boolean;
  range: AdminRange;
}) {
  if (loading || !totals) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }
  const failRate = totals.calls > 0 ? totals.failed / totals.calls : 0;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Estimated cost"
        value={formatMoney(totals.costUsd)}
        hint={
          totals.unpriced > 0
            ? `${RANGE_LABELS[range]}. Token counts × your price table — a lower bound, since ${formatNumber(totals.unpriced)} calls have no price.`
            : `${RANGE_LABELS[range]}. Token counts × your price table, not your provider’s invoice.`
        }
      />
      <KpiCard
        label="AI calls"
        value={formatNumber(totals.calls)}
        hint={[
          totals.failed > 0
            ? `${formatNumber(totals.failed)} failed (${formatPercent(failRate, failRate < 0.1 ? 1 : 0)}): an error or an unusable reply.`
            : 'None failed.',
          'Each call is one request from the bot to the model.',
          totals.refused
            ? `${formatNumber(totals.refused)} more ${totals.refused === 1 ? 'request was' : 'requests were'} refused before reaching the model (a daily limit, or AI turned off) — not counted here.`
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      />
      <KpiCard
        label="Input tokens"
        value={formatNumber(totals.inputTokens, { compact: true })}
        hint="Text sent to the model (the request, task details, chat messages). A token is roughly ¾ of a word."
      />
      <KpiCard
        label="Output tokens"
        value={formatNumber(totals.outputTokens, { compact: true })}
        hint="Text the model wrote back. Output usually costs several times more per token than input."
      />
    </div>
  );
}
