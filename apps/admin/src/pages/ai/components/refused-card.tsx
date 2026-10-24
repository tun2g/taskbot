import type { AdminAiRefusalReason, AdminAiRefusalRow, AdminRange } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { Card, CardHeader } from '@/components/ui/card';
import { Pagination, Segmented } from '@/components/ui/nav';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { PersonCell } from '@/components/ui/values';
import { formatNumber, plural } from '@/lib/format';
import { REFUSAL_REASON_LABELS } from '@/lib/labels';

import type { RefusedList } from '../use-refused';

const reasonsText = (r: AdminAiRefusalRow['byReason']) =>
  (Object.entries(r) as [AdminAiRefusalReason, number][])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${REFUSAL_REASON_LABELS[k]} ${formatNumber(n)}`)
    .join(' · ');

function Who({ row, range }: { row: AdminAiRefusalRow; range: AdminRange }) {
  if ('person' in row) return <PersonCell person={row.person ?? null} />;
  if (!row.group) return <span className="text-text-2">No group (private chat, Mini App home or MCP)</span>;
  if (row.group.deleted) return <span className="text-text-3">{row.group.name}</span>;
  return (
    <Link to="/groups/$groupId" params={{ groupId: row.group.id }} search={{ range, tab: 'settings' }} className="font-medium text-text hover:text-accent-text">
      {row.group.name}
    </Link>
  );
}

/** "Refused (limit) — who": which limit refused how many requests, and for whom. */
export function RefusedCard({
  list,
  byReason,
  range,
}: {
  list: RefusedList;
  byReason: { reason: AdminAiRefusalReason; count: number }[];
  range: AdminRange;
}) {
  return (
    <Card>
      <div id="refused" className="scroll-mt-20" />
      <CardHeader
        title="Refused (limit) — who"
        subtitle={
          byReason.length
            ? `Requests that never reached the model: ${byReason.map((r) => `${REFUSAL_REASON_LABELS[r.reason]} ${formatNumber(r.count)}`).join(' · ')}. Open a person or group to change their limit.`
            : 'Requests that never reached the model because a limit was reached or AI was off.'
        }
        action={
          <Segmented
            label="Refused requests by"
            size="sm"
            value={list.by}
            options={[
              { value: 'person', label: 'Person' },
              { value: 'group', label: 'Group' },
            ]}
            onChange={list.onBy}
          />
        }
      />
      {list.isLoading ? (
        <TableSkeleton rows={3} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.onRetry} retrying={list.retrying} />
      ) : list.rows.length === 0 ? (
        <EmptyState compact title="Nothing was refused in this period." />
      ) : (
        <>
          <ul className="divide-y divide-border border-t border-border">
            {list.rows.map((r, i) => (
              <li key={r.person?.id ?? r.group?.id ?? `none-${i}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Who row={r} range={range} />
                </div>
                <div className="text-right">
                  <div className="text-[15px] text-text tabular">{plural(r.count, 'refused request')}</div>
                  <div className="text-[13px] text-text-3">{reasonsText(r.byReason)}</div>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={list.page} limit={list.limit} total={list.total} onPage={list.onPage} noun={list.by === 'person' ? 'people' : 'groups'} />
        </>
      )}
    </Card>
  );
}
