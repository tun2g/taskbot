import type { AdminGroupRef, AdminGroupRow } from '@tbot/shared';
import { useNavigate } from '@tanstack/react-router';

import type { GroupLifecycleAction } from '@/components/actions/group-actions';
import { Button, TextLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { RelativeTime } from '@/components/ui/values';
import { formatNumber, personName, previousDecisionText } from '@/lib/format';

/** The overview's call to action: groups waiting for approval, oldest first, with inline Approve / Reject. */
export function PendingCard({
  pending,
  total,
  onAction,
  busyGroupId,
}: {
  pending: AdminGroupRow[];
  total: number;
  onAction: (action: GroupLifecycleAction, group: AdminGroupRef) => void;
  busyGroupId?: string;
}) {
  const navigate = useNavigate();
  return (
    <Card className="h-full">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Waiting for your approval
            {total > 0 && (
              <span className="rounded-full bg-warn-soft px-2 text-[13px] font-semibold text-warn tabular">{total}</span>
            )}
          </span>
        }
        subtitle="The bot stays quiet in these groups until you approve them. Approving posts a welcome message there."
        action={
          total > 0 && (
            <TextLink to="/groups" search={{ status: 'pending' as never }} className="text-sm">
              {total > pending.length ? `All ${formatNumber(total)} →` : 'Open list →'}
            </TextLink>
          )
        }
      />
      {pending.length === 0 ? (
        <EmptyState
          compact
          title="No groups are waiting for approval."
          body="When someone adds the bot to a new group, it shows up here and the bot DMs you."
        />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {pending.map((g) => (
            <li
              key={g.id}
              className="flex cursor-pointer flex-col gap-2 px-5 py-3 hover:bg-surface-2/60 sm:flex-row sm:items-center sm:gap-4"
              onClick={() => navigate({ to: '/groups/$groupId', params: { groupId: g.id } })}
            >
              <div className="min-w-0 sm:flex-1">
                <p className="truncate font-medium text-text">{g.name}</p>
                <p className="text-[13px] text-text-3">
                  Added <RelativeTime value={g.addedAt} never="at an unknown time" />
                  {g.addedBy ? ` by ${personName(g.addedBy)}` : ''}
                  {g.memberCount != null ? ` · ${formatNumber(g.memberCount)} people in the chat` : ''}
                </p>
                {g.previousDecision && <p className="mt-0.5 text-[13px] text-warn">{previousDecisionText(g.previousDecision)}</p>}
              </div>
              <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="primary" disabled={busyGroupId === g.id} onClick={() => onAction('approve', g)}>
                  Approve
                </Button>
                <Button size="sm" disabled={busyGroupId === g.id} onClick={() => onAction('reject', g)}>
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
