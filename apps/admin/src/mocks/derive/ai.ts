/** AI breakdowns and totals over a list of calls — the same rules as the API's aggregation. */
import type { AdminAiBreakdownRow, AdminAiCallRow, AdminAiUsage } from '@tbot/shared';
import { AI_FEATURE_LABELS } from '@tbot/shared';

import { refused } from '../fixtures';

export const emptyBreakdown = (key: string, label: string): AdminAiBreakdownRow => ({
  key,
  label,
  calls: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  unpriced: 0,
});

function addCall(row: AdminAiBreakdownRow, c: AdminAiCallRow) {
  // Same rule as the API: refusals never reached the model, so they are neither calls nor failures.
  if (refused(c.status)) {
    row.refused = (row.refused ?? 0) + 1;
    return;
  }
  row.calls++;
  if (c.status === 'failed' || c.status === 'invalid') row.failed++;
  row.inputTokens += c.inputTokens;
  row.outputTokens += c.outputTokens;
  row.costUsd += c.costUsd;
  if (!c.priced) row.unpriced++;
}

export function breakdown(calls: AdminAiCallRow[], keyOf: (c: AdminAiCallRow) => [string, string]): AdminAiBreakdownRow[] {
  const map = new Map<string, AdminAiBreakdownRow>();
  for (const c of calls) {
    const [key, label] = keyOf(c);
    const row = map.get(key) ?? { ...emptyBreakdown(key, label), refused: 0 };
    addCall(row, c);
    map.set(key, row);
  }
  return [...map.values()];
}

export function totals(calls: AdminAiCallRow[]): AdminAiUsage['totals'] {
  const [row] = breakdown(calls, () => ['all', 'all']);
  return row
    ? { calls: row.calls, failed: row.failed, inputTokens: row.inputTokens, outputTokens: row.outputTokens, costUsd: row.costUsd, unpriced: row.unpriced, refused: row.refused }
    : { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0, refused: 0 };
}

/** By feature, most expensive first. */
export const featureRows = (calls: AdminAiCallRow[]) =>
  breakdown(calls, (c) => [c.feature, AI_FEATURE_LABELS[c.feature]]).sort((a, b) => b.costUsd - a.costUsd);
