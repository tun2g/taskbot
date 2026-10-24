import type { AdminGroupDetail } from '@tbot/shared';
import { GROUP_STATUS_HINTS, GroupStatus } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { ACTION_LABELS, actionsFor, type GroupLifecycleAction } from '@/components/actions/group-actions';
import { Badge, GroupStatusBadge } from '@/components/ui/badge';
import { Button, TextLink } from '@/components/ui/button';
import { Meta } from '@/components/ui/card';
import { Menu, MoreIcon } from '@/components/ui/menu';
import { formatDate, formatDateTime, formatNumber, formatRelative, personName, previousDecisionText } from '@/lib/format';

const STATUS_CHANGE_VERB: Partial<Record<GroupStatus, string>> = {
  [GroupStatus.REJECTED]: 'Rejected',
  [GroupStatus.SUSPENDED]: 'Suspended',
  [GroupStatus.LEFT]: 'Bot removed',
  [GroupStatus.MIGRATED]: 'Moved',
  [GroupStatus.ACTIVE]: 'Status changed',
};

export function GroupHeader({
  group,
  onAction,
  busy,
}: {
  group: AdminGroupDetail;
  onAction: (action: GroupLifecycleAction) => void;
  busy: boolean;
}) {
  const { inline, more } = actionsFor(group.status);
  const showChange = group.statusChangedAt && group.status !== GroupStatus.PENDING;

  return (
    <div className="mb-5">
      <Link to="/groups" className="text-[13px] text-text-3 hover:text-text">
        ← Groups
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">{group.name}</h1>
            <GroupStatusBadge status={group.status} />
            {group.isForum && (
              <Badge dot={false} title="A Telegram group with topics; tasks can belong to a topic.">
                Forum
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-text-2">{GROUP_STATUS_HINTS[group.status]}</p>
          {group.previousDecision && (
            <p className="mt-1 text-[13px] text-warn">
              {previousDecisionText(group.previousDecision)}.{' '}
              <TextLink to="/audit-log" search={{ targetType: 'group', targetId: group.id }}>
                See history
              </TextLink>
            </p>
          )}
          {(group.statusReason || showChange) && (
            <p className="mt-1 text-[13px] text-text-3">
              {showChange && (
                <span title={formatDateTime(group.statusChangedAt)}>
                  {STATUS_CHANGE_VERB[group.status] ?? 'Status changed'} {formatRelative(group.statusChangedAt)}
                </span>
              )}
              {showChange && group.statusReason && ' · '}
              {group.statusReason && (
                <span>
                  Reason: <span className="text-text-2">{group.statusReason}</span>
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inline.map((a) => (
            <Button
              key={a}
              variant={a === 'approve' || a === 'unsuspend' ? 'primary' : 'secondary'}
              disabled={busy}
              onClick={() => onAction(a)}
            >
              {ACTION_LABELS[a]}
            </Button>
          ))}
          {more.length > 0 && (
            <Menu
              label={`More actions for ${group.name}`}
              trigger={<MoreIcon />}
              triggerClassName="size-9 border border-border-strong bg-surface"
              items={more.map((a) => ({
                label: ACTION_LABELS[a],
                hint: a === 'leave' ? 'Bot leaves; tasks are kept' : a === 'delete' ? 'Removes all tasks permanently' : undefined,
                danger: a === 'leave' || a === 'delete',
                onSelect: () => onAction(a),
              }))}
            />
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-surface px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
        <Meta label="Added">
          <span title={formatDateTime(group.addedAt ?? group.createdAt)}>{formatDate(group.addedAt ?? group.createdAt)}</span>
          {group.addedBy && (
            <>
              {' by '}
              {group.addedBy.id ? (
                <TextLink to="/users/$userId" params={{ userId: group.addedBy.id }}>
                  {personName(group.addedBy)}
                </TextLink>
              ) : (
                personName(group.addedBy)
              )}
            </>
          )}
        </Meta>
        <Meta label="People in the chat">
          {group.memberCount == null ? (
            <span className="text-text-3" title="Telegram didn’t report a member count (the bot may not be in the chat).">
              Unknown
            </span>
          ) : (
            formatNumber(group.memberCount)
          )}
          <span className="text-text-3"> · {formatNumber(group.knownMembers)} used the bot</span>
        </Meta>
        <Meta label="Last activity">
          <span title={group.lastActivityAt ? formatDateTime(group.lastActivityAt) : undefined}>
            {group.lastActivityAt ? formatRelative(group.lastActivityAt) : 'No activity yet'}
          </span>
        </Meta>
        <Meta label="Timezone">
          <span title="Used for due dates, reminders and the daily digest in this group.">{group.timezone}</span>
        </Meta>
        <Meta label={group.publicLink ? 'Public link' : 'Approved'}>
          {group.publicLink ? (
            <a href={group.publicLink} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
              {group.publicLink.replace(/^https?:\/\//, '')}
            </a>
          ) : group.approvedAt ? (
            <span title={formatDateTime(group.approvedAt)}>{formatDate(group.approvedAt)}</span>
          ) : (
            <span className="text-text-3">Not approved</span>
          )}
        </Meta>
      </dl>

      {group.status === GroupStatus.MIGRATED && (
        <p className="mt-3 text-[13px] text-text-3">
          Telegram upgraded this chat to a supergroup. Its tasks moved to the new group — find it under Active groups.
        </p>
      )}
      {group.botLeftAt && group.status === GroupStatus.LEFT && (
        <p className="mt-3 text-[13px] text-text-3">
          The bot left on {formatDate(group.botLeftAt)}. If someone adds it back, the group’s approval is restored.
        </p>
      )}

      <p className="mt-3 text-[13px]">
        <TextLink to="/audit-log" search={{ targetType: 'group', targetId: group.id }}>
          Activity history — what you changed for this group →
        </TextLink>
      </p>
    </div>
  );
}
