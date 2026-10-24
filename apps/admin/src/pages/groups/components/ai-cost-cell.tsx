import type { AdminGroupRow, AdminRange } from '@tbot/shared';

import { TextLink } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { formatMoney, plural } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';

/**
 * A group's estimated AI cost for the list's period (the activity filter, else the last 30 days). Calls on a model
 * with no price count as $0, so "$0" with calls says how many were unpriced instead of looking free.
 */
export function AiCostCell({ group, period }: { group: AdminGroupRow; period: AdminRange | undefined }) {
  const p = period && group.inPeriod ? group.inPeriod : null;
  const cost = p ? p.aiCostUsd : group.aiCostUsd30d;
  const calls = p ? p.aiCalls : group.aiCalls30d;
  const unpriced = (p ? p.aiUnpriced : group.aiUnpriced30d) ?? 0;
  const range: AdminRange = period ?? '30d';
  const when = RANGE_LABELS[range].toLowerCase();

  if (cost === 0 && calls === 0) return <span className="text-text-3">$0</span>;
  const link = { to: '/ai' as const, search: { groupId: group.id, range } };

  if (unpriced > 0) {
    const allUnpriced = cost === 0;
    return (
      <Tooltip
        content={`${plural(unpriced, 'AI call')} in the ${when} used a model with no price in your price table, so ${allUnpriced ? 'the cost shows as $0' : 'the real cost is higher'}. Add a price in Settings.`}
      >
        <TextLink {...link} className="text-warn">
          {formatMoney(cost)}
          {allUnpriced ? <span className="text-[13px]"> · {plural(unpriced, 'call')} unpriced</span> : '+'}
        </TextLink>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={`${plural(calls, 'AI call')} in the ${when} — see each one`}>
      <TextLink {...link}>{formatMoney(cost)}</TextLink>
    </Tooltip>
  );
}
