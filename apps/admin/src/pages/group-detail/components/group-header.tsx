import type { AdminGroupDetail } from '@tbot/shared';
import { GROUP_STATUS_HINTS, GroupStatus } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { ACTION_HINTS, ACTION_LABELS, actionsFor, type GroupLifecycleAction } from '@/components/actions/group-actions';
import { Badge, GroupStatusBadge } from '@/components/ui/badge';
import { Button, TextLink } from '@/components/ui/button';
import { Menu, MoreIcon } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { formatDateTime, formatRelative, previousDecisionText } from '@/lib/format';

import { GroupMeta } from './group-meta';
import { howToReverse, STATUS_CHANGE_VERB } from './group-status-help';

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
  const reverse = howToReverse(group);

  return (
    <div className="mb-5">
      <Link to="/groups" className="text-sm text-text-3 hover:text-text">
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
          <p className="mt-1 text-[15px] text-text-2">{GROUP_STATUS_HINTS[group.status]}</p>
          {group.status === GroupStatus.MIGRATED && (
            <p className="mt-1 text-[15px]">
              {group.migratedTo ? (
                <TextLink to="/groups/$groupId" params={{ groupId: group.migratedTo.id }} className="font-medium">
                  Continues as {group.migratedTo.name} →
                </TextLink>
              ) : (
                <span className="text-text-3">
                  The new supergroup isn’t in your list (it may have been deleted, or the bot never saw it).
                </span>
              )}
            </p>
          )}
          {reverse && <p className="mt-1 max-w-3xl text-sm text-text-3">{reverse}</p>}
          {group.previousDecision && (
            <p className="mt-1 text-sm text-warn">
              {previousDecisionText(group.previousDecision)}.{' '}
              <TextLink to="/audit-log" search={{ targetType: 'group', targetId: group.id }}>
                See history
              </TextLink>
            </p>
          )}
          {(group.statusReason || showChange) && (
            <p className="mt-1 text-sm text-text-3">
              {showChange && (
                <Tooltip content={formatDateTime(group.statusChangedAt)}>
                  <span>
                    {STATUS_CHANGE_VERB[group.status] ?? 'Status changed'} {formatRelative(group.statusChangedAt)}
                  </span>
                </Tooltip>
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
              triggerClassName="size-10 rounded-xl border border-border-strong bg-surface"
              items={more.map((a) => ({
                label: ACTION_LABELS[a],
                hint: ACTION_HINTS[a],
                danger: a === 'leave' || a === 'delete',
                onSelect: () => onAction(a),
              }))}
            />
          )}
        </div>
      </div>

      <GroupMeta group={group} />

      <p className="mt-3 text-sm">
        <TextLink to="/audit-log" search={{ targetType: 'group', targetId: group.id }}>
          Your changes to this group (audit log) →
        </TextLink>
      </p>
    </div>
  );
}
