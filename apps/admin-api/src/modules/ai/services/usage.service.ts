import type { AdminAiBreakdownRow, AdminAiUsage, AdminRange } from '@tbot/shared';
import type { GroupBy } from 'src/modules/ai/helpers/options';
import { loadGroupRefs, loadPersonRefs } from 'src/shared/refs';
import { sumBreakdown } from 'src/stats/aggregate';
import { breakdownRow, breakdownRows, featureLabel } from 'src/stats/breakdown';
import { aiTotalsBy, DAY_EXPR } from 'src/stats/queries';
import type { DayWindow } from 'src/stats/range';
import { ReasonCounts, refusalsBy, refusalTotals, sumReasons } from 'src/stats/refusals';

/** Calls without a group (private chat, the Mini App home, MCP outside a group). */
export const NO_GROUP_LABEL = 'No group (private chat, Mini App home or MCP)';

const FIELD: Record<GroupBy, string | Record<string, unknown>> = {
  day: DAY_EXPR('createdAt'),
  feature: 'feature',
  model: 'aiModel',
  group: 'groupId',
  user: 'userId',
};

/** "" (not tied to a group / person) becomes the key "none", and each row gets its refusals. */
function withRefused(rows: AdminAiBreakdownRow[], refused: Map<string, ReasonCounts> | null): AdminAiBreakdownRow[] {
  return rows.map((r) => ({ ...r, key: r.key || 'none', refused: sumReasons(refused?.get(r.key)) }));
}

/**
 * AI usage in a window, one row per `groupBy` key. One set of totals: the sum of the rows (every call is in
 * exactly one row) plus every refusal in the window.
 */
export async function aiUsage(range: AdminRange, window: DayWindow, groupBy: GroupBy, match: Record<string, unknown>): Promise<AdminAiUsage> {
  const byPerson = groupBy === 'user';
  const [totals, refusals, refusedByKey] = await Promise.all([
    aiTotalsBy(match, FIELD[groupBy]),
    refusalTotals(match),
    groupBy === 'group' || byPerson ? refusalsBy(match, byPerson ? 'userId' : 'groupId') : Promise.resolve(null),
  ]);

  let rows: AdminAiBreakdownRow[];
  if (groupBy === 'day') {
    rows = window.days.map((day) => breakdownRow(day, day, totals.get(day)));
  } else if (groupBy === 'group') {
    const refs = await loadGroupRefs(totals.keys());
    rows = withRefused(breakdownRows(totals, (k) => (k ? (refs.get(k)?.name ?? 'Deleted group') : NO_GROUP_LABEL)), refusedByKey);
  } else if (byPerson) {
    const refs = await loadPersonRefs(totals.keys());
    rows = withRefused(breakdownRows(totals, (k) => (k ? (refs.get(k)?.name ?? 'Unknown person') : 'No person')), refusedByKey);
  } else if (groupBy === 'feature') {
    rows = breakdownRows(totals, featureLabel);
  } else {
    rows = breakdownRows(totals, (k) => k || 'Unknown model');
  }
  return { range, groupBy, totals: { ...sumBreakdown(rows), refused: refusals.total }, rows, refusedByReason: refusals.byReason };
}
