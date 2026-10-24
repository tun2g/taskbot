import type { AdminAuditEntry } from '@tbot/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Td, Tr } from '@/components/ui/table';
import { RelativeTime } from '@/components/ui/values';
import { formatDateTimeUtc } from '@/lib/format';

import { TargetLink } from './target-link';

function ReasonCell({ entry: e }: { entry: AdminAuditEntry }) {
  const sent = e.details?.notifiedGroup === true;
  if (!e.reason && !sent) return <span className="text-text-3">—</span>;
  return (
    <>
      {e.reason && <span>{e.reason}</span>}
      {sent && (
        <div className={e.reason ? 'mt-1' : undefined}>
          <Badge tone="neutral" dot={false} title="The group was told in Telegram (with your reason, if you gave one).">
            Sent to group
          </Badge>
        </div>
      )}
    </>
  );
}

/** One audit entry: when (relative + exact UTC, readable on touch screens), what changed, your reason, about what. */
export function AuditRow({ entry: e, onRestore }: { entry: AdminAuditEntry; onRestore?: () => void }) {
  return (
    <Tr>
      <Td className="text-text-2">
        <RelativeTime value={e.at} />
        <div className="text-[13px] whitespace-nowrap text-text-3">{formatDateTimeUtc(e.at)}</div>
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
        {onRestore && (
          <Button size="sm" variant="secondary" className="mt-2" onClick={onRestore}>
            Restore the values from before this change
          </Button>
        )}
      </Td>
      <Td className="max-w-xs text-text-2">
        <ReasonCell entry={e} />
      </Td>
      <Td>
        <TargetLink entry={e} />
      </Td>
    </Tr>
  );
}
