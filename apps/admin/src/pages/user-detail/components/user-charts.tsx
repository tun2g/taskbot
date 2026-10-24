import type { AdminRange, AdminUserDetail } from '@tbot/shared';

import { DailyChart } from '@/components/charts/daily-chart';
import { TextLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';

/** Activity and estimated AI cost per day (charts only — totals come from the API). */
export function UserCharts({ user, range, trackingSince }: { user: AdminUserDetail; range: AdminRange; trackingSince: string | null }) {
  const userId = user.person.id ?? '';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Activity per day" subtitle="Bot actions: commands, taps, Mini App & MCP." />
        <CardBody>
          <DailyChart
            ariaLabel="Activity per day"
            data={user.daily}
            series={[{ key: 'events', label: 'Activity', color: 'var(--series-1)' }]}
            trackedFrom={trackingSince}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Est. AI cost per day"
          subtitle="Token counts × your price table."
          action={
            <TextLink to="/ai" search={{ userId, range }} className="text-sm">
              See calls
            </TextLink>
          }
        />
        <CardBody>
          <DailyChart
            ariaLabel="Estimated AI cost per day"
            data={user.daily}
            series={[{ key: 'aiCostUsd', label: 'Est. AI cost', color: 'var(--series-1)' }]}
            format={(v) => formatMoney(v)}
            axisFormat={(v) => formatMoney(v, { axis: true, compact: true })}
            trackedFrom={trackingSince}
          />
        </CardBody>
      </Card>
    </div>
  );
}
