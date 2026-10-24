import type { AdminRange } from '@tbot/shared';

import { useOverview } from '@/api/overview';
import { Notice } from '@/components/ui/states';
import { formatDay } from '@/lib/format';
import { RANGE_DAYS } from '@/lib/labels';

/** First day of a range, as the API counts it (UTC days, today included). */
export function rangeStart(range: AdminRange): string {
  return new Date(Date.now() - (RANGE_DAYS[range] - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** trackingSince comes with the overview; other pages read it from the (cached) overview query. */
export function useTrackingSince(range: AdminRange): { trackingSince: string | null; loaded: boolean } {
  const overview = useOverview(range);
  return { trackingSince: overview.data?.trackingSince ?? null, loaded: !!overview.data };
}

/**
 * Stats only exist since tracking was deployed. Say so plainly when the range starts earlier.
 * `what` names the numbers affected on this page.
 */
export function TrackingNotice({
  trackingSince,
  from,
  what = 'earlier days have task counts only',
}: {
  trackingSince: string | null;
  from: string;
  what?: string;
}) {
  if (trackingSince === null) {
    return (
      <Notice tone="warn">
        Usage tracking hasn’t recorded anything yet, so activity, AI and MCP numbers are empty. Task counts still
        show.
      </Notice>
    );
  }
  if (trackingSince <= from) return null;
  return (
    <Notice>
      Tracking started on {formatDay(trackingSince, { withYear: true })} — {what}.
    </Notice>
  );
}
