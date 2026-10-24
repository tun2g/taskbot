import { GROUP_STATUS_HINTS, GROUP_STATUS_VALUES, GroupStatus } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { GroupStatusBadge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';

/** Every group the bot was ever added to, by status. Each line opens the filtered group list. */
export function GroupsByStatusCard({ counts }: { counts: Record<GroupStatus, number> }) {
  const total = GROUP_STATUS_VALUES.reduce((s, k) => s + (counts[k] ?? 0), 0);
  return (
    <Card>
      <CardHeader title="Groups by status" subtitle={`All ${formatNumber(total)} groups the bot was ever added to, right now.`} />
      <ul className="px-2 pb-3">
        {GROUP_STATUS_VALUES.map((status) => (
          <li key={status}>
            <Link
              to="/groups"
              search={{ status }}
              className="flex items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
            >
              <span className="min-w-0">
                <GroupStatusBadge status={status} />
                <span className="mt-1 block text-xs text-text-3">{GROUP_STATUS_HINTS[status]}</span>
              </span>
              <span className="pt-0.5 text-sm font-semibold text-text tabular">{formatNumber(counts[status] ?? 0)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
