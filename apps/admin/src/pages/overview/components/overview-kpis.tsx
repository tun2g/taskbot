import type { AdminOverview, AdminRange } from '@tbot/shared';

import { TextLink } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/kpi';
import { formatMoney, formatNumber } from '@/lib/format';

/** People, groups with activity, tasks created and AI cost — each opens the list behind it. */
export function OverviewKpis({
  kpis,
  range,
  previousUntracked,
}: {
  kpis: AdminOverview['kpis'];
  range: AdminRange;
  /** The previous period lies before tracking started (no fair comparison). */
  previousUntracked: boolean;
}) {
  const rangeSearch = { range: range === '30d' ? undefined : range };
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Active people today (DAU)"
        value={formatNumber(kpis.dau)}
        hint="People who used the bot today (since midnight UTC), in any group or channel."
        footer={
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
            <TextLink to="/users" search={{ activeIn: 'today' }}>
              Today: {formatNumber(kpis.dau)} →
            </TextLink>
            <TextLink to="/users" search={{ activeIn: '7d' }}>
              7 days (WAU): {formatNumber(kpis.wau)} →
            </TextLink>
            <TextLink to="/users" search={{ activeIn: '30d' }}>
              30 days (MAU): {formatNumber(kpis.mau)} →
            </TextLink>
          </p>
        }
      />
      <KpiCard
        label="Groups with activity"
        value={formatNumber(kpis.activeGroups.value)}
        current={kpis.activeGroups.value}
        previous={kpis.activeGroups.previous}
        previousMissing={previousUntracked}
        hint="Groups where someone used the bot, created a task or used AI in this period — whatever their status is now."
        to="/groups"
        search={{ activeIn: range }}
      />
      <KpiCard
        label="Tasks created"
        value={formatNumber(kpis.tasksCreated.value, { compact: true })}
        current={kpis.tasksCreated.value}
        previous={kpis.tasksCreated.previous}
        hint="New tasks across all groups, from chat, the Mini App and MCP. Opens the groups they were made in; each group’s count opens its tasks."
        to="/groups"
        search={{ activeIn: range, sort: 'tasks' }}
      />
      <KpiCard
        label="AI cost (estimated)"
        value={formatMoney(kpis.aiCostUsd.value, { compact: true })}
        current={kpis.aiCostUsd.value}
        previous={kpis.aiCostUsd.previous}
        previousMissing={previousUntracked}
        neutralDelta
        hint={`${formatNumber(kpis.aiCalls.value)} AI calls. Cost is estimated from token counts × your price table.`}
        to="/ai"
        search={rangeSearch}
      />
    </div>
  );
}
