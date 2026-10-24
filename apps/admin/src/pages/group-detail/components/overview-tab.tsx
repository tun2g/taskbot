import type { AdminGroupDetail, AdminRange } from '@tbot/shared';

import { TrackingNotice } from '@/components/tracking-notice';

import { OverviewCharts } from './overview-charts';
import { OverviewKpis } from './overview-kpis';
import { UsageByChannelCard } from './usage-by-channel-card';

export function OverviewTab({
  group,
  range,
  trackingSince,
  trackingLoaded,
  rangeFrom,
}: {
  group: AdminGroupDetail;
  range: AdminRange;
  trackingSince: string | null;
  trackingLoaded: boolean;
  rangeFrom: string;
}) {
  return (
    <div className="space-y-4">
      {trackingLoaded && (
        <TrackingNotice
          trackingSince={trackingSince}
          from={rangeFrom}
          what="earlier days have task counts only; activity and AI charts start that day"
        />
      )}
      <OverviewKpis group={group} range={range} />
      <OverviewCharts group={group} trackedFrom={trackingLoaded ? trackingSince : undefined} />
      <UsageByChannelCard usage={group.usage} range={range} />
    </div>
  );
}
