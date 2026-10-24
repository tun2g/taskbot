import type { AdminMcpOverview } from '@tbot/shared';

import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { PersonCell } from '@/components/ui/values';
import { plural } from '@/lib/format';

export function RateLimitedCard({ rows }: { rows: NonNullable<AdminMcpOverview['rateLimitedBy']> }) {
  return (
    <Card>
      <CardHeader
        title="Refused (limit) — who"
        subtitle="People whose AI client sent requests too fast. If one person dominates, their client is probably looping; revoke that token on their page."
      />
      {rows.length === 0 ? (
        <EmptyState compact title="No one was refused in this period." />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((u) => (
            <li key={u.person.telegramUserId} className="flex items-center justify-between gap-3 px-5 py-3">
              <PersonCell person={u.person} />
              <span className="shrink-0 text-sm text-text-2 tabular">{plural(u.count, 'refused request')}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
