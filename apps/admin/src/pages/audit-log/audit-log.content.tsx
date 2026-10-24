import type { AdminAuditEntry } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { Card, PageHeader } from '@/components/ui/card';
import { FilterChip, Pagination, Tabs } from '@/components/ui/nav';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { RelativeTime } from '@/components/ui/values';
import { AUDIT_TARGET_LABELS } from '@/lib/labels';
import type { AuditTarget } from '@/lib/search';

const LINK = 'text-accent-text hover:underline';

function TargetLink({ entry }: { entry: AdminAuditEntry }) {
  const label = entry.targetLabel;
  if (entry.targetMissing) {
    return (
      <span className="text-text-2" title="Deleted since — there is no page to open.">
        {label ?? '—'} <span className="text-[13px] text-text-3">(deleted)</span>
      </span>
    );
  }
  if (entry.targetType === 'group' && entry.targetId)
    return (
      <Link to="/groups/$groupId" params={{ groupId: entry.targetId }} className={LINK}>
        {label ?? 'Open group'}
      </Link>
    );
  if (entry.targetType === 'user' && entry.targetId)
    return (
      <Link to="/users/$userId" params={{ userId: entry.targetId }} className={LINK}>
        {label ?? 'Open person'}
      </Link>
    );
  if (entry.targetType === 'settings')
    return (
      <Link to="/settings" className={LINK}>
        {label ?? 'Settings'}
      </Link>
    );
  return label ? <span className="text-text-2">{label}</span> : <span className="text-text-3">—</span>;
}

export function AuditLogContent(props: {
  entries: AdminAuditEntry[];
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  targetType?: AuditTarget;
  targetId?: string;
  onTargetType: (t?: AuditTarget) => void;
  onClearTarget: () => void;
  onPage: (page: number) => void;
}) {
  const { entries } = props;
  const tabs = [
    { value: 'all' as const, label: 'All' },
    ...(Object.keys(AUDIT_TARGET_LABELS) as AuditTarget[]).map((t) => ({ value: t, label: AUDIT_TARGET_LABELS[t] })),
  ];
  const targetName = entries.find((e) => e.targetId === props.targetId)?.targetLabel;

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change you made in the admin app — approvals, suspensions, AI limits, settings and sign-ins — newest first."
      />
      <Card>
        <div className="px-5 pt-2">
          <Tabs
            items={tabs}
            value={props.targetType ?? 'all'}
            onChange={(v) => props.onTargetType(v === 'all' ? undefined : v)}
          />
        </div>
        {props.targetId && (
          <div className="px-5 pt-3">
            <FilterChip
              label={<>Only: {targetName ?? (props.targetType === 'user' ? 'this person' : 'this item')}</>}
              onRemove={props.onClearTarget}
            />
          </div>
        )}
        <div className="pt-3">
          {props.isLoading ? (
            <TableSkeleton />
          ) : props.error ? (
            <ErrorState message={props.error} onRetry={props.onRetry} retrying={props.retrying} />
          ) : entries.length === 0 ? (
            props.targetId || props.targetType ? (
              <EmptyState title="Nothing recorded here yet." body="Changes you make to this show up here." />
            ) : (
              <EmptyState
                title="You haven’t changed anything yet."
                body="When you approve a group, change an AI limit or update settings, it’s recorded here."
              />
            )
          ) : (
            <>
              <Table>
                <THead>
                  <Th>When</Th>
                  <Th>What happened</Th>
                  <Th hint="what you typed; shown to the group for reject, suspend and leave">Reason</Th>
                  <Th>About</Th>
                </THead>
                <tbody>
                  {entries.map((e) => (
                    <Tr key={e.id}>
                      <Td className="text-text-2">
                        <RelativeTime value={e.at} />
                      </Td>
                      <Td className="text-text">
                        {e.summary}
                        {e.changes && e.changes.length > 0 && (
                          <ul className="mt-0.5 space-y-0.5 text-[13px] text-text-2">
                            {e.changes.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        )}
                      </Td>
                      <Td className="max-w-xs text-text-2">{e.reason ?? <span className="text-text-3">—</span>}</Td>
                      <Td>
                        <TargetLink entry={e} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={props.page} limit={props.limit} total={props.total} onPage={props.onPage} noun="entries" />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
