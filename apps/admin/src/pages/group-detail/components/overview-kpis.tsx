import type { AdminGroupDetail, AdminRange } from '@tbot/shared';

import { KpiCard } from '@/components/ui/kpi';
import { formatMoney, formatNumber, plural } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';

/** The group's headline numbers; each opens the list behind it. */
export function OverviewKpis({ group, range }: { group: AdminGroupDetail; range: AdminRange }) {
  const aiCost = group.daily.reduce((s, d) => s + d.aiCostUsd, 0);
  const aiCalls = group.daily.reduce((s, d) => s + d.aiCalls, 0);
  const groupLink = { to: '/groups/$groupId' as const, params: { groupId: group.id } };

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <KpiCard
        label="Open tasks"
        value={formatNumber(group.openTasks)}
        hint={`Not done yet, out of ${plural(group.tasks, 'task')} in total (all time). See them →`}
        {...groupLink}
        search={{ tab: 'tasks', view: 'open' }}
      />
      <KpiCard
        label="Epics"
        value={formatNumber(group.counts.epics)}
        hint="Groupings of related tasks, all time. See them →"
        {...groupLink}
        search={{ tab: 'tasks', view: 'epics' }}
      />
      <KpiCard
        label="People using the bot"
        value={formatNumber(group.knownMembers)}
        hint="People in this group who have used the bot at least once. See who →"
        {...groupLink}
        search={{ tab: 'members' }}
      />
      <KpiCard
        label="Active MCP tokens"
        value={formatNumber(group.counts.activeTokens)}
        hint="Made only for this group. People’s all-group tokens also reach it — see People using the bot →"
        {...groupLink}
        search={{ tab: 'members', sort: 'tokens' }}
      />
      <KpiCard
        label="AI cost"
        value={formatMoney(aiCost)}
        hint={`${plural(aiCalls, 'AI call')} in the ${RANGE_LABELS[range].toLowerCase()}, estimated from your price table. See every call →`}
        to="/ai"
        search={{ groupId: group.id, range }}
        neutralDelta
      />
    </div>
  );
}
