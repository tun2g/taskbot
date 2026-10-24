import type { AdminAuditEntry } from '@tbot/shared';

import { Card, PageHeader } from '@/components/ui/card';
import { FilterChip, Tabs } from '@/components/ui/nav';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { AUDIT_TARGET_LABELS } from '@/lib/labels';
import type { AuditTarget } from '@/lib/search';

import { AuditTable } from './components/audit-table';
import { RestoreDialog } from './components/restore-dialog';
import { auditEmptyText } from './lib/empty-text';
import { useRestoreSettings } from './lib/use-restore-settings';

const TABS = [
  { value: 'all' as const, label: 'All' },
  ...(Object.keys(AUDIT_TARGET_LABELS) as AuditTarget[]).map((t) => ({ value: t, label: AUDIT_TARGET_LABELS[t] })),
];

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
  const restore = useRestoreSettings();
  const targetName = entries.find((e) => e.targetId === props.targetId)?.targetLabel ?? undefined;
  const empty = auditEmptyText(props.targetType, targetName, !!props.targetId);

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change you made in the admin app — approvals, suspensions, AI limits, settings, jobs you ran and sign-ins — newest first."
      />
      <Card>
        <div className="px-5 pt-2">
          <Tabs
            items={TABS}
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
            <ErrorState
              title="Couldn’t load the audit log"
              message={props.error}
              onRetry={props.onRetry}
              retrying={props.retrying}
            />
          ) : entries.length === 0 ? (
            <EmptyState title={empty.title} body={empty.body} />
          ) : (
            <AuditTable
              entries={entries}
              page={props.page}
              limit={props.limit}
              total={props.total}
              onPage={props.onPage}
              onRestore={restore.open}
            />
          )}
        </div>
      </Card>
      <RestoreDialog
        entry={restore.entry}
        before={restore.before}
        current={restore.current}
        pending={restore.pending}
        onCancel={restore.cancel}
        onConfirm={restore.confirm}
      />
    </>
  );
}
