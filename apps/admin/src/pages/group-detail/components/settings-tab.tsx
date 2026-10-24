import type { AdminAiOverrideInput, AdminGroupDetail } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { AiOverrideForm } from '@/components/actions/ai-override-form';
import { ACTION_LABELS, actionsFor, type GroupLifecycleAction } from '@/components/actions/group-actions';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';

const CONSEQUENCES: Partial<Record<GroupLifecycleAction, string>> = {
  suspend: 'The bot, Mini App and MCP stop working for this group. Tasks are kept; you can unsuspend at any time.',
  unsuspend: 'Service resumes and the group gets a short message that the bot is back.',
  leave: 'The bot leaves the chat. Tasks are kept, and re-adding the bot restores the approval.',
  delete: 'Permanently deletes this group’s tasks, epics, member links and MCP tokens. Usage and cost history are kept.',
};

export function SettingsTab({
  group,
  onSaveAi,
  savingAi,
  onAction,
  busy,
}: {
  group: AdminGroupDetail;
  onSaveAi: (input: AdminAiOverrideInput) => void;
  savingAi: boolean;
  onAction: (action: GroupLifecycleAction) => void;
  busy: boolean;
}) {
  const { inline, more } = actionsFor(group.status);
  const danger = [...inline, ...more].filter((a) => a in CONSEQUENCES);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="AI for this group"
          subtitle="Override the AI limits for this group only. Other groups are not affected."
        />
        <CardBody>
          <AiOverrideForm
            subject="group"
            disabled={group.aiDisabled}
            dailyLimit={group.aiDailyLimit}
            defaultLimitText="no per-group limit — the global daily limit and each person’s limit apply"
            pending={savingAi}
            onSave={onSaveAi}
          />
        </CardBody>
      </Card>

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
          {danger.map((a) => (
            <li key={a} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">{ACTION_LABELS[a]}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-3">{CONSEQUENCES[a]}</p>
              </div>
              <Button
                size="sm"
                variant={a === 'unsuspend' ? 'primary' : a === 'delete' ? 'danger' : 'danger-outline'}
                disabled={busy}
                onClick={() => onAction(a)}
              >
                {ACTION_LABELS[a]}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
