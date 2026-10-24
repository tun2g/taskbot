import type { AdminGroupRef, AdminRange } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { ShareBar } from '@/components/charts/daily-chart';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';

interface Row {
  group: AdminGroupRef;
  value: number;
  display: string;
  detail: string;
}

/** Top-5 list; each row drills down (to the group, or to that group's AI calls). */
export function TopGroupsCard({
  title,
  subtitle,
  empty,
  rows,
  linkTo,
  range,
}: {
  title: string;
  subtitle: string;
  empty: string;
  rows: Row[];
  linkTo: 'group' | 'ai';
  range: AdminRange;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {rows.length === 0 ? (
        <EmptyState compact title={empty} />
      ) : (
        <ol className="space-y-1 px-2 pb-3">
          {rows.map((r) => {
            const inner = (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-text">{r.group.name}</span>
                  <span className="shrink-0 text-sm font-medium text-text tabular">
                    {r.display} <span className="text-[13px] font-normal text-text-3">{r.detail}</span>
                  </span>
                </div>
                <div className="mt-1.5">
                  <ShareBar value={r.value} max={max} />
                </div>
              </>
            );
            const cls = 'block rounded-lg px-2 py-2 hover:bg-surface-2';
            return (
              <li key={r.group.id}>
                {r.group.deleted && linkTo === 'group' ? (
                  <div className={cls} title="This group was deleted; its past activity still counts.">
                    {inner}
                  </div>
                ) : linkTo === 'group' ? (
                  <Link to="/groups/$groupId" params={{ groupId: r.group.id }} search={{ range: range === '30d' ? undefined : range }} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <Link to="/ai" search={{ groupId: r.group.id, range: range === '30d' ? undefined : range }} className={cls}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
