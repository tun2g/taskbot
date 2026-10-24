import type { AdminGroupRow } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { TextLink } from '@/components/ui/button';
import { GroupStatusBadge } from '@/components/ui/badge';
import { previousDecisionText } from '@/lib/format';

/** Status badge plus what the owner needs next to it: the earlier decision, the reason, where a moved group went. */
export function StatusCell({ group }: { group: AdminGroupRow }) {
  const g = group;
  return (
    <>
      <GroupStatusBadge status={g.status} />
      {g.previousDecision && <span className="mt-1 line-clamp-2 text-[13px] text-warn">{previousDecisionText(g.previousDecision)}</span>}
      {g.statusReason && (g.status === GroupStatus.REJECTED || g.status === GroupStatus.SUSPENDED) && (
        <span className="mt-1 line-clamp-2 text-[13px] text-text-3">Reason: {g.statusReason}</span>
      )}
      {g.status === GroupStatus.MIGRATED && (
        <span className="mt-1 block text-[13px] text-text-3">
          {g.migratedTo ? (
            <span onClick={(e) => e.stopPropagation()}>
              Moved to{' '}
              <TextLink to="/groups/$groupId" params={{ groupId: g.migratedTo.id }}>
                {g.migratedTo.name}
              </TextLink>
            </span>
          ) : (
            'New group not found'
          )}
        </span>
      )}
    </>
  );
}
