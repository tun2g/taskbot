import type { AdminGroupRef, AdminOverview, AdminRange } from '@tbot/shared';

import type { GroupLifecycleAction } from '@/components/actions/group-actions';
import { DailyChart } from '@/components/charts/daily-chart';
import { TrackingNotice } from '@/components/tracking-notice';
import { TextLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi';
import { ErrorState, PageSkeleton } from '@/components/ui/states';
import { formatDay, formatMoney, formatNumber } from '@/lib/format';
import { CHANNEL_HINTS, CHANNEL_LABELS, RANGE_DAYS, RANGE_LABELS } from '@/lib/labels';

import { AiTodayCard } from './components/ai-today-card';
import { AttentionCard } from './components/attention-card';
import { GroupsByStatusCard } from './components/groups-by-status-card';
import { PendingCard } from './components/pending-card';
import { TopGroupsCard } from './components/top-groups-card';

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

  const { kpis } = overview;
  const tracked = overview.trackingSince;
  const rangeSearch = { range: range === '30d' ? undefined : range };
  // Usage, AI and MCP numbers only exist from the day tracking started; a previous period before that has no data.
  const previousFrom = shiftDay(overview.from, -RANGE_DAYS[range]);
  const previousUntracked = !tracked || tracked > previousFrom;

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
            label="Active groups"
            value={formatNumber(kpis.activeGroups.value)}
            current={kpis.activeGroups.value}
            previous={kpis.activeGroups.previous}
            previousMissing={previousUntracked}
            hint="Groups where someone used the bot, created a task or used AI in this period (whatever their status now)."
            to="/groups"
            search={{ activeIn: range }}
          />
          <KpiCard
            label="Tasks created"
            value={formatNumber(kpis.tasksCreated.value, { compact: true })}
            current={kpis.tasksCreated.value}
            previous={kpis.tasksCreated.previous}
            hint="New tasks across all groups, from chat, the Mini App and MCP. Opens the groups they were created in."
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Active people per day" subtitle="Distinct people who used the bot that day, in any group." />
            <CardBody>
              <DailyChart
                ariaLabel="Active people per day"
                kind="line"
                data={overview.daily}
                series={[{ key: 'activeUsers', label: 'Active people', color: 'var(--series-1)' }]}
                trackedFrom={tracked}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Tasks created per day"
              subtitle="Counted from the tasks themselves, so this goes back before tracking started."
            />
            <CardBody>
              <DailyChart
                ariaLabel="Tasks created per day"
                data={overview.daily}
                series={[{ key: 'tasksCreated', label: 'Tasks created', color: 'var(--series-1)' }]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="AI cost per day"
              subtitle="Estimated: token counts × your price table."
              action={<KpiLink to="/ai" search={rangeSearch} label="Breakdown" />}
            />
            <CardBody>
              <DailyChart
                ariaLabel="Estimated AI cost per day"
                data={overview.daily}
                series={[{ key: 'aiCostUsd', label: 'Estimated cost', color: 'var(--series-1)' }]}
                format={(v) => formatMoney(v)}
                trackedFrom={tracked}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="AI calls per day"
              subtitle="Calls sent to the AI model. “Didn’t work” = provider errors and unusable replies. Requests refused by a limit were never sent, so they aren’t counted here."
              action={<KpiLink to="/ai" search={{ ...rangeSearch, groupBy: 'day' }} label="Calls" />}
            />
            <CardBody>
              <DailyChart
                ariaLabel="AI calls per day"
                stacked
                data={overview.daily.map((d) => ({ day: d.day, ok: d.aiCalls - d.aiFailed, failed: d.aiFailed }))}
                series={[
                  { key: 'ok', label: 'Succeeded', color: 'var(--series-1)' },
                  { key: 'failed', label: 'Didn’t work', color: 'var(--series-2)' },
                ]}
                trackedFrom={tracked}
              />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Where people use the bot"
            subtitle={`Requests per day by channel. ${CHANNEL_LABELS.telegram}: ${CHANNEL_HINTS.telegram}. ${CHANNEL_LABELS.app}: ${CHANNEL_HINTS.app}. ${CHANNEL_LABELS.mcp}: ${CHANNEL_HINTS.mcp}.`}
            action={<KpiLink to="/mcp" search={rangeSearch} label="MCP details" />}
          />
          <CardBody>
            <DailyChart
              ariaLabel="Requests per day by channel"
              stacked
              data={overview.daily.map((d) => ({
                day: d.day,
                telegram: d.channels.telegram ?? 0,
                app: d.channels.app ?? 0,
                mcp: d.channels.mcp ?? 0,
              }))}
              series={[
                { key: 'telegram', label: CHANNEL_LABELS.telegram, color: 'var(--series-1)' },
                { key: 'app', label: CHANNEL_LABELS.app, color: 'var(--series-2)' },
                { key: 'mcp', label: CHANNEL_LABELS.mcp, color: 'var(--series-3)' },
              ]}
              trackedFrom={tracked}
              height={220}
            />
          </CardBody>
        </Card>

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


function KpiLink({ to, search, label }: { to: '/ai' | '/mcp'; search: Record<string, unknown>; label: string }) {
  return (
    <TextLink to={to} search={search as never} className="text-sm">
      {label} →
    </TextLink>
  );
}

/** "2026-10-24" shifted by n days (UTC). */
function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
