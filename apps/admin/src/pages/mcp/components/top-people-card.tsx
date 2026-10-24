import type { AdminMcpOverview } from '@tbot/shared';

import { ShareBar } from '@/components/charts/daily-chart';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { PersonCell } from '@/components/ui/values';
import { formatNumber, plural } from '@/lib/format';

export function TopPeopleCard({ rows, rangeLabel, onOpen }: { rows: AdminMcpOverview['topUsers']; rangeLabel: string; onOpen: (userId: string) => void }) {
  const max = Math.max(0, ...rows.map((u) => u.calls));
  return (
    <Card>
      <CardHeader title="Top people" subtitle={`Who made the most MCP calls · ${rangeLabel}. Click to open the person.`} />
      {rows.length === 0 ? (
        <EmptyState compact title="No one in this period." />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((u) => {
            const extra = [u.failed ? `${formatNumber(u.failed)} failed` : null, u.rateLimited ? `${formatNumber(u.rateLimited)} refused (limit)` : null].filter(Boolean);
            return (
              <li
                key={u.person.telegramUserId}
                className={u.person.id ? 'cursor-pointer px-5 py-3 hover:bg-surface-2/70' : 'px-5 py-3'}
                onClick={u.person.id ? () => onOpen(u.person.id!) : undefined}
              >
                <div className="flex items-center justify-between gap-3">
                  <PersonCell person={u.person} link={false} />
                  <span className="shrink-0 text-right text-sm text-text-2 tabular">
                    {plural(u.calls, 'call')}
                    {extra.length > 0 && <span className="block text-[13px] text-text-3">{extra.join(' · ')}</span>}
                  </span>
                </div>
                <div className="mt-1.5">
                  <ShareBar value={u.calls} max={max} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
