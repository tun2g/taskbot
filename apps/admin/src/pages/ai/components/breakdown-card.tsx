import type { AdminAiBreakdownRow, AdminAiUsage, AdminRange, AiFeature } from '@tbot/shared';

import { Card, CardHeader } from '@/components/ui/card';
import { Segmented } from '@/components/ui/nav';
import { GROUP_BY_LABELS } from '@/lib/labels';
import { type AiSearch, GROUP_BY_VALUES } from '@/lib/search';

import { BreakdownTable } from './breakdown-table';

const GROUP_BY_TITLES: Record<AdminAiUsage['groupBy'], string> = {
  day: 'One row per day',
  feature: 'Which bot feature made the call',
  model: 'Which AI model answered',
  group: 'Which group the call was for',
  user: 'Who asked for it',
};

/** The breakdown by day / feature / model / group / person; a row narrows the calls below to it. */
export function BreakdownCard({
  usage,
  loading,
  groupBy,
  range,
  onUpdate,
}: {
  usage: AdminAiUsage | undefined;
  loading: boolean;
  groupBy: AdminAiUsage['groupBy'];
  range: AdminRange;
  onUpdate: (patch: Partial<AiSearch>, opts?: { scrollToCalls?: boolean }) => void;
}) {
  const drill = (row: AdminAiBreakdownRow) => {
    if (groupBy === 'feature') onUpdate({ feature: row.key as AiFeature }, { scrollToCalls: true });
    else if (groupBy === 'group' && row.key !== 'none') onUpdate({ groupId: row.key }, { scrollToCalls: true });
    else if (groupBy === 'user' && row.key !== 'none') onUpdate({ userId: row.key }, { scrollToCalls: true });
  };
  const hint =
    groupBy === 'day' || groupBy === 'model'
      ? 'Day and model rows can’t be filtered yet — use the filters on the calls below.'
      : groupBy === 'user'
        ? 'Click a name to open the person, or the row to see their calls.'
        : 'Click a row to see its individual calls.';
  return (
    <Card>
      <CardHeader
        title="Breakdown"
        subtitle={`${GROUP_BY_TITLES[groupBy]}. ${hint} Rows add up to the total.`}
        action={
          <Segmented
            label="Group the breakdown by"
            size="sm"
            value={groupBy}
            options={GROUP_BY_VALUES.map((v) => ({ value: v, label: GROUP_BY_LABELS[v], title: GROUP_BY_TITLES[v] }))}
            onChange={(v) => onUpdate({ groupBy: v === 'feature' ? undefined : v })}
          />
        }
      />
      <BreakdownTable usage={usage} loading={loading} groupBy={groupBy} range={range} onDrill={drill} />
    </Card>
  );
}
