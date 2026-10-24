import type { AdminGroupDeletePreview, AdminGroupRef } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';
import type { ReactNode } from 'react';

import type { GroupAction } from '@/api/groups';
import type { ConfirmOptions } from '@/components/ui/dialog';
import { plural } from '@/lib/format';

export type GroupLike = Pick<AdminGroupRef, 'id' | 'name' | 'status'>;

/** What deleting removes, from the delete preview. */
export function deleteBody(group: GroupLike, preview: AdminGroupDeletePreview | undefined, error: string | null): ReactNode {
  if (error) return <p className="text-danger">Couldn’t load what would be deleted: {error}</p>;
  if (!preview) return <p>Checking what this would delete…</p>;
  const parts = [
    plural(preview.tasks, 'task'),
    plural(preview.epics, 'epic'),
    `${preview.members === 1 ? '1 person’s link' : `${plural(preview.members, 'person', 'people')}’s links`} to this group (their accounts are kept)`,
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

/** The confirmation for each action: what happens, in the owner's words. */
export function actionConfirmOptions(action: GroupAction, group: GroupLike): ConfirmOptions {
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
            <p>
              {group.status === GroupStatus.SUSPENDED
                ? 'If someone adds the bot back, the group is still suspended until you unsuspend it.'
                : 'If someone adds the bot back, the group’s approval is restored — you won’t need to approve it again.'}
            </p>
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
    case 'reconsider':
      return {
        title: `Clear the rejection of ${name}?`,
        body: (
          <>
            <p>
              The bot isn’t in this chat and can’t rejoin by itself, so nothing changes in Telegram now. The group moves
              to “Bot removed” and members no longer see your rejection reason.
            </p>
            <p>
              If someone adds the bot again, the group waits for your approval like a new group — it is not approved
              automatically. Tasks are kept.
            </p>
          </>
        ),
        confirmLabel: 'Clear rejection',
      };
  }
}
