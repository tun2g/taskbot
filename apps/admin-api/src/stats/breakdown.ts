import type { AdminAiBreakdownRow } from '@tbot/shared';
import { AI_FEATURE_LABELS, AiFeature } from '@tbot/shared';
import { roundUsd } from 'src/stats/aggregate';
import type { AiTotals } from 'src/stats/queries';

export function breakdownRow(key: string, label: string, t: AiTotals | undefined): AdminAiBreakdownRow {
  return {
    key,
    label,
    calls: t?.calls ?? 0,
    failed: t?.failed ?? 0,
    inputTokens: t?.inputTokens ?? 0,
    outputTokens: t?.outputTokens ?? 0,
    costUsd: roundUsd(t?.costUsd ?? 0),
    unpriced: t?.unpriced ?? 0,
  };
}

/** Rows sorted by cost, then calls (biggest first). */
export function breakdownRows(totals: Map<string, AiTotals>, label: (key: string) => string): AdminAiBreakdownRow[] {
  return [...totals.entries()]
    .map(([k, t]) => breakdownRow(k, label(k), t))
    .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

export const featureLabel = (key: string) => AI_FEATURE_LABELS[key as AiFeature] ?? (key || 'Unknown');
