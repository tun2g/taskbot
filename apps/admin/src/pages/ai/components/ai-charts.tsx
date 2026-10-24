import type { AdminAiBreakdownRow, AdminRange } from '@tbot/shared';

import { DailyChart } from '@/components/charts/daily-chart';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/states';
import { formatMoney } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';

/** Est. AI cost per day and AI calls per day (succeeded / failed). */
export function AiCharts({
  rows,
  loading,
  range,
  trackingSince,
}: {
  rows: AdminAiBreakdownRow[] | undefined;
  loading: boolean;
  range: AdminRange;
  trackingSince: string | null | undefined;
}) {
  const data = (rows ?? []).map((r) => ({ day: r.key, cost: r.costUsd, ok: r.calls - r.failed, failed: r.failed }));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Est. AI cost per day" subtitle={`${RANGE_LABELS[range]}, in US dollars (UTC days).`} />
        <CardBody>
          {loading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : (
            <DailyChart
              ariaLabel="Estimated AI cost per day"
              data={data}
              series={[{ key: 'cost', label: 'Est. AI cost', color: 'var(--series-1)' }]}
              format={(v) => formatMoney(v, { compact: true })}
              axisFormat={(v) => formatMoney(v, { axis: true, compact: true })}
              trackedFrom={trackingSince ?? undefined}
            />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="AI calls per day"
          subtitle="Each time the bot asked the model something. Failed = an error or an unusable reply. Requests refused by a limit never reach the model and aren’t counted."
        />
        <CardBody>
          {loading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : (
            <DailyChart
              ariaLabel="AI calls per day, succeeded and failed"
              data={data}
              stacked
              series={[
                { key: 'ok', label: 'Succeeded', color: 'var(--series-1)' },
                { key: 'failed', label: 'Failed', color: 'var(--series-2)' },
              ]}
              trackedFrom={trackingSince ?? undefined}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
