import type { AdminGroupDetail } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { ACTION_LABELS, actionsFor, type GroupLifecycleAction } from '@/components/actions/group-actions';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';

const CONSEQUENCES: Partial<Record<GroupLifecycleAction, string>> = {
  suspend: 'The bot, Mini App and MCP stop working for this group. Tasks are kept; you can unsuspend at any time.',
  unsuspend: 'Service resumes and the group gets a short message that the bot is back.',
  leave: 'The bot leaves the chat. Tasks are kept, and re-adding the bot restores the approval.',
  reconsider: 'Clears your rejection. Nothing happens in Telegram now; if someone adds the bot again, the group waits for your approval.',
  delete: 'Permanently deletes this group’s tasks, epics, people’s links to it and MCP tokens. Usage and cost history are kept.',
};

/** Lifecycle actions for the group, each with what it does. */
export function DangerZoneCard({
  group,
  onAction,
  busy,
}: {
  group: AdminGroupDetail;
  onAction: (action: GroupLifecycleAction) => void;
  busy: boolean;
}) {
  const { inline, more } = actionsFor(group.status);
  const actions = [...inline, ...more].filter((a) => a in CONSEQUENCES);

  return (
    <Card className="border-danger/30">
      <CardHeader
        title="Danger zone"
        subtitle={
          group.status === GroupStatus.PENDING
            ? 'This group is waiting for approval — approve or reject it from the top of the page.'
            : 'Change whether the bot serves this group.'
        }
      />
      <ul className="divide-y divide-border border-t border-border">
        {actions.map((a) => (
          <li key={a} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-text">{ACTION_LABELS[a]}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-text-3">{CONSEQUENCES[a]}</p>
            </div>
            <Button
              size="sm"
              variant={a === 'unsuspend' || a === 'reconsider' ? 'primary' : a === 'delete' ? 'danger' : 'danger-outline'}
              disabled={busy}
              onClick={() => onAction(a)}
            >
              {ACTION_LABELS[a]}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
