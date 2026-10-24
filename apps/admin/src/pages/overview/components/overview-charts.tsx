import type { AdminOverview, AdminRange } from '@tbot/shared';

import { DailyChart } from '@/components/charts/daily-chart';
import { TextLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';
import { AI_FAILED_LABEL, CHANNEL_HINTS, CHANNEL_LABELS } from '@/lib/labels';

function ChartLink({ to, search, label }: { to: '/ai' | '/mcp'; search: Record<string, unknown>; label: string }) {
  return (
    <TextLink to={to} search={search as never} className="text-sm">
      {label} →
    </TextLink>
  );
}

/** The overview's daily charts: people, tasks, AI cost, AI calls (succeeded / failed) and requests by channel. */
export function OverviewCharts({ overview, range }: { overview: AdminOverview; range: AdminRange }) {
  const tracked = overview.trackingSince;
  const rangeSearch = { range: range === '30d' ? undefined : range };
  return (
    <>
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
          <CardHeader title="Tasks created per day" subtitle="Counted from the tasks themselves, so this goes back before tracking started." />
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
            action={<ChartLink to="/ai" search={rangeSearch} label="Breakdown" />}
          />
          <CardBody>
            <DailyChart
              ariaLabel="Estimated AI cost per day"
              data={overview.daily}
              series={[{ key: 'aiCostUsd', label: 'Estimated cost', color: 'var(--series-1)' }]}
              format={(v) => formatMoney(v)}
              axisFormat={(v) => formatMoney(v, { axis: true, compact: true })}
              trackedFrom={tracked}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="AI calls per day"
            subtitle="Calls sent to the AI model. Failed = provider error or unusable reply. Requests refused by a limit were never sent, so they aren’t AI calls."
            action={<ChartLink to="/ai" search={{ ...rangeSearch, groupBy: 'day' }} label="Calls" />}
          />
          <CardBody>
            <DailyChart
              ariaLabel="AI calls per day"
              stacked
              data={overview.daily.map((d) => ({ day: d.day, ok: d.aiCalls - d.aiFailed, failed: d.aiFailed }))}
              series={[
                { key: 'ok', label: 'Succeeded', color: 'var(--series-1)' },
                { key: 'failed', label: AI_FAILED_LABEL, color: 'var(--series-2)' },
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
          action={<ChartLink to="/mcp" search={rangeSearch} label="MCP details" />}
        />
        <CardBody>
          <DailyChart
            ariaLabel="Requests per day by channel"
            stacked
            data={overview.daily.map((d) => ({ day: d.day, telegram: d.channels.telegram ?? 0, app: d.channels.app ?? 0, mcp: d.channels.mcp ?? 0 }))}
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
    </>
  );
}
