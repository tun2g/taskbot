import type { AdminGroupRef, AdminOverview, AdminRange } from '@tbot/shared';

import type { GroupLifecycleAction } from '@/components/actions/group-actions';
import { TrackingNotice } from '@/components/tracking-notice';
import { Card, PageHeader } from '@/components/ui/card';
import { ErrorState, PageSkeleton } from '@/components/ui/states';
import { formatDay, formatMoney, formatNumber } from '@/lib/format';
import { RANGE_DAYS, RANGE_LABELS } from '@/lib/labels';

import { AiTodayCard } from './components/ai-today-card';
import { AttentionCard } from './components/attention-card';
import { GroupsByStatusCard } from './components/groups-by-status-card';
import { OverviewCharts } from './components/overview-charts';
import { OverviewKpis } from './components/overview-kpis';
import { PendingCard } from './components/pending-card';
import { TopGroupsCard } from './components/top-groups-card';
import { shiftDay } from './overview.utils';

export function OverviewContent({
  range,
  overview,
  isLoading,
  isRefreshing,
  error,
  onRetry,
  onGroupAction,
  busyGroupId,
}: {
  range: AdminRange;
  overview: AdminOverview | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  onRetry: () => void;
  onGroupAction: (action: GroupLifecycleAction, group: AdminGroupRef) => void;
  busyGroupId?: string;
}) {
  const header = (
    <PageHeader
      title="Overview"
      subtitle={
        overview
          ? `${RANGE_LABELS[range]} · ${formatDay(overview.from, { withYear: true })} – ${formatDay(overview.to, { withYear: true })} (UTC days). Every number opens the page that explains it.`
          : `${RANGE_LABELS[range]}. Every number opens the page that explains it.`
      }
    />
  );

  if (isLoading) return <>{header}<PageSkeleton /></>;
  if (error || !overview) {
    return (
      <>
        {header}
        <Card>
          <ErrorState message={error ?? 'No data.'} onRetry={onRetry} />
        </Card>
      </>
    );
  }

  const tracked = overview.trackingSince;
  // Usage, AI and MCP numbers only exist from the day tracking started; a previous period before that has no data.
  const previousUntracked = !tracked || tracked > shiftDay(overview.from, -RANGE_DAYS[range]);

  return (
    <div className={isRefreshing ? 'opacity-80 transition-opacity' : undefined}>
      {header}
      <div className="space-y-4">
        <TrackingNotice trackingSince={tracked} from={overview.from} />

        <AttentionCard items={overview.attention} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PendingCard pending={overview.pending} total={overview.groupsByStatus.pending} onAction={onGroupAction} busyGroupId={busyGroupId} />
          </div>
          <AiTodayCard today={overview.aiToday} />
        </div>

        <OverviewKpis kpis={overview.kpis} range={range} previousUntracked={previousUntracked} />

        <OverviewCharts overview={overview} range={range} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <TopGroupsCard
            title="Most active groups"
            subtitle="Requests to the bot in this period (chat, Mini App and MCP)."
            empty="No group used the bot in this period."
            rows={overview.topGroupsByActivity.map((r) => ({
              group: r.group,
              value: r.events,
              display: formatNumber(r.events),
              detail: 'requests',
            }))}
            linkTo="group"
            range={range}
          />
          <TopGroupsCard
            title="Highest AI cost"
            subtitle="Estimated cost in this period. Opens that group’s AI calls."
            empty="No AI calls in this period."
            rows={overview.topGroupsByAiCost.map((r) => ({
              group: r.group,
              value: r.costUsd,
              display: formatMoney(r.costUsd),
              detail: `${formatNumber(r.calls)} calls`,
            }))}
            linkTo="ai"
            range={range}
          />
          <GroupsByStatusCard counts={overview.groupsByStatus} />
        </div>
      </div>
    </div>
  );
}
