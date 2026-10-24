import type { AdminGroupDeletePreview, AdminGroupRef } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';
import { type ReactNode, useCallback, useState } from 'react';

import { type GroupAction, useDeleteGroup, useGroupAction, useGroupDeletePreview } from '@/api/groups';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, type ConfirmOptions } from '@/components/ui/dialog';
import { Menu, type MenuItem, MoreIcon } from '@/components/ui/menu';
import { getErrorMessage } from '@/lib/api-client';
import { plural } from '@/lib/format';

export type GroupLifecycleAction = GroupAction | 'delete';

type GroupLike = Pick<AdminGroupRef, 'id' | 'name' | 'status'>;

function deleteBody(group: GroupLike, preview: AdminGroupDeletePreview | undefined, error: string | null): ReactNode {
  if (error) return <p className="text-danger">Couldn’t load what would be deleted: {error}</p>;
  if (!preview) return <p>Checking what this would delete…</p>;
  const parts = [
    plural(preview.tasks, 'task'),
    plural(preview.epics, 'epic'),
    `${plural(preview.members, 'member')}’ links`,
    plural(preview.tokens, 'MCP token'),
  ];
  return (
    <>
      <p>
        This permanently deletes {parts.slice(0, -1).join(', ')} and {parts[parts.length - 1]}
        {preview.activities > 0 ? ` (plus ${plural(preview.activities, 'activity entry', 'activity entries')})` : ''} of{' '}
        <strong className="text-text">{group.name}</strong>.
      </p>
      <p>Usage and AI cost history are kept, so past totals stay correct — they show as “Deleted group”. The bot leaves the chat. This cannot be undone.</p>
      {(group.status === GroupStatus.ACTIVE || group.status === GroupStatus.SUSPENDED) && (
        <p>
          To stop service but keep the tasks, use <strong className="text-text">Suspend</strong> or{' '}
          <strong className="text-text">Leave chat</strong> instead.
        </p>
      )}
    </>
  );
}

function options(action: GroupAction, group: GroupLike): ConfirmOptions {
  const name = `“${group.name}”`;
  switch (action) {
    case 'approve':
      return {
        title: `Approve ${name}?`,
        body: (
          <p>
            The bot starts working in this group and posts a welcome message there, so members know they can create
            tasks, open the Mini App and connect MCP.
          </p>
        ),
        confirmLabel: 'Approve',
      };
    case 'reject':
      return {
        title: `Reject ${name}?`,
        body: (
          <>
            <p>The bot posts your reason in the group and leaves the chat. Nothing is deleted.</p>
            <p>If someone adds the bot again, the group waits for your approval again.</p>
          </>
        ),
        confirmLabel: 'Reject and leave',
        variant: 'danger',
        reason: {
          required: true,
          label: 'Reason',
          hint: 'Posted in the group, so members know why.',
          placeholder: 'e.g. This bot is for work teams only.',
        },
      };
    case 'suspend':
      return {
        title: `Suspend ${name}?`,
        body: (
          <>
            <p>
              The bot stops replying, and the Mini App and MCP stop working for this group. Tasks are kept, and you can
              unsuspend at any time.
            </p>
          </>
        ),
        confirmLabel: 'Suspend',
        variant: 'danger',
        reason: {
          required: true,
          label: 'Reason',
          hint: 'Posted in the group, so members know why service paused.',
          placeholder: 'e.g. Paused while we review usage.',
        },
      };
    case 'unsuspend':
      return {
        title: `Resume service for ${name}?`,
        body: <p>The bot, Mini App and MCP work again, and the group gets a short message that service is back.</p>,
        confirmLabel: 'Unsuspend',
      };
    case 'leave':
      return {
        title: `Make the bot leave ${name}?`,
        body: (
          <>
            <p>The bot posts a goodbye message and leaves the chat. Tasks are kept.</p>
            <p>If someone adds the bot back, the group’s approval is restored — you won’t need to approve it again.</p>
          </>
        ),
        confirmLabel: 'Leave chat',
        variant: 'danger',
        reason: {
          required: false,
          label: 'Reason',
          hint: 'If you add one, it’s included in the goodbye message.',
        },
      };
  }
}

/**
 * Approve / reject / suspend / unsuspend / leave / delete with the right confirmation for each.
 * Render `dialog` once; call `request(action, group)` from buttons.
 */
export function useGroupLifecycle(opts: { onDeleted?: () => void } = {}) {
  const [state, setState] = useState<{ action: GroupLifecycleAction; group: GroupLike } | null>(null);
  const action = useGroupAction();
  const del = useDeleteGroup(opts.onDeleted);
  const preview = useGroupDeletePreview(state?.group.id ?? '', state?.action === 'delete');

  const close = useCallback(() => setState(null), []);
  const request = useCallback((a: GroupLifecycleAction, group: GroupLike) => setState({ action: a, group }), []);

  let confirm: ConfirmOptions | null = null;
  if (state?.action === 'delete') {
    confirm = {
      title: `Delete “${state.group.name}” permanently?`,
      body: deleteBody(state.group, preview.data, preview.isError ? getErrorMessage(preview.error) : null),
      confirmLabel: 'Delete forever',
      variant: 'danger',
      typeToConfirm: state.group.name,
      loadingBody: !preview.data,
    };
  } else if (state) {
    confirm = options(state.action, state.group);
  }

  const dialog = (
    <ConfirmDialog
      open={!!state}
      options={confirm}
      pending={action.isPending || del.isPending}
      onCancel={close}
      onConfirm={(reason) => {
        if (!state) return;
        if (state.action === 'delete') {
          del.mutate({ group: state.group, confirmName: state.group.name }, { onSettled: close });
        } else {
          action.mutate({ group: state.group, action: state.action, reason }, { onSettled: close });
        }
      }}
    />
  );

  return { request, dialog, pendingId: action.isPending || del.isPending ? state?.group.id : undefined };
}

/** Which actions a status allows: the first ones go inline, the rest into "⋯". */
export function actionsFor(status: GroupStatus): { inline: GroupLifecycleAction[]; more: GroupLifecycleAction[] } {
  switch (status) {
    case GroupStatus.PENDING:
      return { inline: ['approve', 'reject'], more: ['leave', 'delete'] };
    case GroupStatus.ACTIVE:
      return { inline: ['suspend'], more: ['leave', 'delete'] };
    case GroupStatus.SUSPENDED:
      return { inline: ['unsuspend'], more: ['leave', 'delete'] };
    default:
      return { inline: [], more: ['delete'] };
  }
}

export const ACTION_LABELS: Record<GroupLifecycleAction, string> = {
  approve: 'Approve',
  reject: 'Reject',
  suspend: 'Suspend',
  unsuspend: 'Unsuspend',
  leave: 'Leave chat',
  delete: 'Delete group',
};

const ACTION_HINTS: Partial<Record<GroupLifecycleAction, string>> = {
  leave: 'Bot leaves; tasks are kept',
  delete: 'Removes all tasks permanently',
};

/** Row actions for a group table: ≤3 inline buttons, the rest behind "⋯". */
export function GroupRowActions({
  group,
  onAction,
  busy,
}: {
  group: GroupLike;
  onAction: (action: GroupLifecycleAction, group: GroupLike) => void;
  busy?: boolean;
}) {
  const { inline, more } = actionsFor(group.status);
  const items: MenuItem[] = more.map((a) => ({
    label: ACTION_LABELS[a],
    hint: ACTION_HINTS[a],
    danger: a === 'delete' || a === 'leave',
    onSelect: () => onAction(a, group),
  }));
  return (
    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {inline.map((a) => (
        <Button
          key={a}
          size="sm"
          variant={a === 'approve' || a === 'unsuspend' ? 'primary' : 'secondary'}
          disabled={busy}
          onClick={() => onAction(a, group)}
        >
          {ACTION_LABELS[a]}
        </Button>
      ))}
      {items.length > 0 && <Menu label={`More actions for ${group.name}`} trigger={<MoreIcon />} items={items} />}
    </div>
  );
}
