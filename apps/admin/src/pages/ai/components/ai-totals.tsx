import type { AdminAiUsage, AdminRange } from '@tbot/shared';

import { Cost } from '@/components/ui/cost';
import { KpiCard } from '@/components/ui/kpi';
import { Skeleton } from '@/components/ui/states';
import { formatNumber, formatPercent } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';
import { scrollToSection } from '@/lib/use-scroll-to-hash';

export function AiTotals({ totals, loading, range }: { totals: AdminAiUsage['totals'] | undefined; loading: boolean; range: AdminRange }) {
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
  const refused = totals.refused ?? 0;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Est. AI cost"
        value={<Cost usd={totals.costUsd} unpriced={totals.unpriced} className="items-start" />}
        hint={`${RANGE_LABELS[range]}. Token counts × your price table, not your provider’s invoice.`}
      />
      <KpiCard
        label="AI calls"
        value={formatNumber(totals.calls)}
        hint={
          totals.failed > 0
            ? `${formatNumber(totals.failed)} failed (${formatPercent(failRate, failRate < 0.1 ? 1 : 0)}): an error or an unusable reply. Each call is one request from the bot to the model.`
            : 'None failed. Each call is one request from the bot to the model.'
        }
      />
      <KpiCard
        label="Refused (limit)"
        value={formatNumber(refused)}
        hint="Requests that never reached the model: a daily limit was reached, too many came in a row, or AI is off. Not counted in AI calls."
        footer={
          refused > 0 && (
            <button type="button" onClick={() => scrollToSection('refused')} className="mt-2 cursor-pointer text-[13px] text-accent-text hover:underline">
              See who was refused ↓
            </button>
          )
        }
      />
      <KpiCard
        label="Tokens in / out"
        value={
          <>
            {formatNumber(totals.inputTokens, { compact: true })}
            <span className="text-text-3"> / </span>
            {formatNumber(totals.outputTokens, { compact: true })}
          </>
        }
        hint="Text sent to the model / written back. A token is roughly ¾ of a word; output usually costs several times more per token."
      />
    </div>
  );
}
