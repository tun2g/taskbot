import type { AdminAiOverrideInput, AdminGroupDetail } from '@tbot/shared';

import { AiOverrideForm } from '@/components/actions/ai-override-form';
import type { GroupLifecycleAction } from '@/components/actions/group-actions';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { groupLimitsNow } from '@/lib/ai-limits';
import { formatNumber } from '@/lib/format';

import { aiCallStats } from '../group-detail.utils';
import { DangerZoneCard } from './danger-zone-card';

export interface AiLimits {
  global: number | null;
  perPerson: number;
}

function defaultLimitText(limits: AiLimits | null): string {
  if (!limits) return 'no per-group limit — the global daily limit and each person’s limit apply';
  const global = limits.global == null ? 'no global daily limit' : `the global limit of ${formatNumber(limits.global)} calls/day for all groups`;
  return `no per-group limit — ${global} and ${formatNumber(limits.perPerson)} calls per person per day apply`;
}

/** "This group: 12 calls today · avg 31/day · peak 58/day (last 30 days)" — so a limit isn't set blind. */
function UsageLine({ group }: { group: AdminGroupDetail }) {
  const s = aiCallStats(group.daily);
  if (s.days === 0) return null;
  return (
    <>
      This group: <span className="font-medium text-text tabular">{formatNumber(s.today)}</span> calls today · avg{' '}
      <span className="tabular">{formatNumber(Math.round(s.avg))}</span>/day · peak <span className="tabular">{formatNumber(s.peak)}</span>
      /day (last {s.days} days)
    </>
  );
}

export function SettingsTab({
  group,
  aiLimits,
  onSaveAi,
  savingAi,
  onAction,
  busy,
}: {
  group: AdminGroupDetail;
  aiLimits: AiLimits | null;
  onSaveAi: (input: AdminAiOverrideInput) => void;
  savingAi: boolean;
  onAction: (action: GroupLifecycleAction) => void;
  busy: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="AI for this group" subtitle="Override the AI limits for this group only. Other groups are not affected." />
        <CardBody>
          <AiOverrideForm
            subject="group"
            disabled={group.aiDisabled}
            dailyLimit={group.aiDailyLimit}
            reason={group.aiReason ?? null}
            rightNow={groupLimitsNow(aiLimits, { disabled: group.aiDisabled, dailyLimit: group.aiDailyLimit })}
            defaultLimitText={defaultLimitText(aiLimits)}
            pending={savingAi}
            onSave={onSaveAi}
            usage={<UsageLine group={group} />}
          />
        </CardBody>
      </Card>
      <DangerZoneCard group={group} onAction={onAction} busy={busy} />
    </div>
  );
}
