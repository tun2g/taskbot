import type { AdminGroupDetail, UsageChannel } from '@tbot/shared';
import { USAGE_CHANNEL_VALUES } from '@tbot/shared';

import { DailyChart } from '@/components/charts/daily-chart';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { AI_FAILED_LABEL, CHANNEL_LABELS } from '@/lib/labels';

const CHANNEL_COLORS: Record<UsageChannel, string> = {
  telegram: 'var(--series-1)',
  app: 'var(--series-2)',
  mcp: 'var(--series-3)',
};

/** Four daily charts for one group: people, tasks, AI calls (succeeded / failed) and requests by channel. */
export function OverviewCharts({ group, trackedFrom }: { group: AdminGroupDetail; trackedFrom: string | null | undefined }) {
  const rows = group.daily.map((d) => ({
    day: d.day,
    activeUsers: d.activeUsers,
    tasksCreated: d.tasksCreated,
    aiOk: d.aiCalls - d.aiFailed,
    aiFailed: d.aiFailed,
    telegram: d.channels.telegram ?? 0,
    app: d.channels.app ?? 0,
    mcp: d.channels.mcp ?? 0,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Active people per day" subtitle="People who used the bot in this group that day (chat, Mini App or MCP)." />
        <CardBody>
          <DailyChart
            kind="line"
            data={rows}
            series={[{ key: 'activeUsers', label: 'Active people', color: 'var(--series-1)' }]}
            trackedFrom={trackedFrom}
            ariaLabel="Active people per day in this group"
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Tasks created per day" subtitle="New tasks in this group, from any channel. Counted from tasks, so earlier days are included." />
        <CardBody>
          <DailyChart
            data={rows}
            series={[{ key: 'tasksCreated', label: 'Tasks created', color: 'var(--series-1)' }]}
            ariaLabel="Tasks created per day in this group"
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="AI calls per day"
          subtitle="Requests the bot sent to the AI model for this group. Failed = provider error or unusable reply. Requests refused by a limit were never sent, so they aren’t AI calls."
        />
        <CardBody>
          <DailyChart
            data={rows}
            stacked
            series={[
              { key: 'aiOk', label: 'Succeeded', color: 'var(--series-1)' },
              { key: 'aiFailed', label: AI_FAILED_LABEL, color: 'var(--series-2)' },
            ]}
            trackedFrom={trackedFrom}
            ariaLabel="AI calls per day in this group, succeeded and failed"
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Where requests came from" subtitle="Requests to the bot per day, by channel." />
        <CardBody>
          <DailyChart
            data={rows}
            stacked
            series={USAGE_CHANNEL_VALUES.map((c) => ({ key: c, label: CHANNEL_LABELS[c], color: CHANNEL_COLORS[c] }))}
            trackedFrom={trackedFrom}
            ariaLabel="Requests per day by channel in this group"
          />
        </CardBody>
      </Card>
    </div>
  );
}
