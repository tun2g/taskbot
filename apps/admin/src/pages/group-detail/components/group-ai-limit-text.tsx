import type { AdminGroupDetail } from '@tbot/shared';

import { TextLink } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';

/** "No group limit (global 400/day)" / "Group limit: 50/day" / "AI off" — opens the group's Settings tab. */
export function GroupAiLimitText({ group, globalLimit }: { group: AdminGroupDetail; globalLimit: number | null | undefined }) {
  const text = group.aiDisabled
    ? 'AI is turned off for this group'
    : group.aiDailyLimit != null
      ? `Group limit: ${formatNumber(group.aiDailyLimit)} calls/day`
      : globalLimit === undefined
        ? 'No group limit'
        : globalLimit === null
          ? 'No group limit (and no global limit)'
          : `No group limit (global ${formatNumber(globalLimit)}/day)`;
  return (
    <TextLink to="/groups/$groupId" params={{ groupId: group.id }} search={{ tab: 'settings' }} className="text-sm">
      {text} →
    </TextLink>
  );
}
