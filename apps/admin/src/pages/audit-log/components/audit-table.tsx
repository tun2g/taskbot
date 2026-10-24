import type { AdminAuditEntry } from '@tbot/shared';

import { Pagination } from '@/components/ui/nav';
import { Table, Th, THead } from '@/components/ui/table';

import { settingsBefore } from '../lib/restore';
import { AuditRow } from './audit-row';

export function AuditTable({
  entries,
  page,
  limit,
  total,
  onPage,
  onRestore,
}: {
  entries: AdminAuditEntry[];
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
  onRestore: (entry: AdminAuditEntry) => void;
}) {
  return (
    <>
      <Table>
        <THead>
          <Th hint="exact time in UTC below">When</Th>
          <Th>What happened</Th>
          <Th hint="what you typed; the group saw it when marked “Sent to group”">Your reason</Th>
          <Th>About</Th>
        </THead>
        <tbody>
          {entries.map((e) => (
            <AuditRow key={e.id} entry={e} onRestore={settingsBefore(e) ? () => onRestore(e) : undefined} />
          ))}
        </tbody>
      </Table>
      <Pagination page={page} limit={limit} total={total} onPage={onPage} noun="entries" />
    </>
  );
}
