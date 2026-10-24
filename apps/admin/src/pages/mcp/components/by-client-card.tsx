import type { AdminMcpOverview } from '@tbot/shared';

import { ShareBar } from '@/components/charts/daily-chart';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatNumber, plural } from '@/lib/format';

export function ByClientCard({ rows, client, onClient }: { rows: AdminMcpOverview['byClient']; client?: string; onClient: (client: string | undefined) => void }) {
  const max = Math.max(0, ...rows.map((c) => c.calls));
  return (
    <Card>
      <CardHeader title="By client" subtitle="The app the AI runs in, as it names itself. Click to see only its calls." />
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((c) => {
          const active = client === c.client;
          return (
            <li key={c.client}>
              <button
                type="button"
                onClick={() => onClient(active ? undefined : c.client)}
                className={cn('block w-full cursor-pointer px-5 py-3 text-left hover:bg-surface-2/70', active && 'bg-accent-soft/60')}
              >
                <div className="mb-1 flex justify-between gap-3 text-sm">
                  <span className="text-text">{c.client}</span>
                  <span className="text-text-2 tabular">
                    {plural(c.calls, 'call')}
                    {c.failed ? <span className="text-text-3"> · {formatNumber(c.failed)} failed</span> : null}
                  </span>
                </div>
                <ShareBar value={c.calls} max={max} />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
