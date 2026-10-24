import { GroupStatus } from '@tbot/shared';
import { useCallback, useState } from 'react';

import { type GroupAction, useDeleteGroup, useGroupAction, useGroupDeletePreview } from '@/api/groups';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, type ConfirmOptions } from '@/components/ui/dialog';
import { Menu, type MenuItem, MoreIcon } from '@/components/ui/menu';
import { getErrorMessage } from '@/lib/api-client';

import { actionConfirmOptions, deleteBody, type GroupLike } from './group-action-confirms';

export type GroupLifecycleAction = GroupAction | 'delete';


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
    confirm = actionConfirmOptions(state.action, state.group);
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
      // No "Leave chat" here: Reject is the way to say no (it tells the group why).
      return { inline: ['approve', 'reject'], more: ['delete'] };
    case GroupStatus.ACTIVE:
      return { inline: ['suspend'], more: ['leave', 'delete'] };
    case GroupStatus.SUSPENDED:
      return { inline: ['unsuspend'], more: ['leave', 'delete'] };
    case GroupStatus.REJECTED:
      return { inline: ['reconsider'], more: ['delete'] };
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
  reconsider: 'Reconsider',
  delete: 'Delete group',
};

export const ACTION_HINTS: Partial<Record<GroupLifecycleAction, string>> = {
  leave: 'Bot leaves; tasks are kept',
  delete: 'Removes all tasks permanently',
  reconsider: 'Clears the rejection; a re-add asks you again',
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
