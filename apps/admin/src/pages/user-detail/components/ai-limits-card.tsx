import type { AdminAiOverrideInput, AdminUserDetail } from '@tbot/shared';

import { AiOverrideForm } from '@/components/actions/ai-override-form';
import { TextLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';

/** "Used today: 7 of 10 · Refused today: 3 (limit 10/day)" — with a link to the refused requests. */
function TodayLine({ user }: { user: AdminUserDetail }) {
  const { used, refused, limit } = user.aiToday;
  const limitText = limit == null ? 'no daily limit' : `limit ${formatNumber(limit)}/day`;
  return (
    <>
      {used != null && limit != null && <>Used today: {formatNumber(used)} of {formatNumber(limit)} · </>}
      Refused today: <strong className="font-semibold text-text">{formatNumber(refused)}</strong> ({limitText})
      {refused > 0 && user.person.id && (
        <>
          {' · '}
          <TextLink to="/ai" search={{ userId: user.person.id, range: '7d' }} hash="refused">
            who refused them →
          </TextLink>
        </>
      )}
    </>
  );
}

export function AiLimitsCard({
  user,
  rightNow,
  defaultLimitText,
  saving,
  onSave,
}: {
  user: AdminUserDetail;
  rightNow: string;
  defaultLimitText: string;
  saving: boolean;
  onSave: (input: AdminAiOverrideInput) => void;
}) {
  return (
    <Card>
      <div id="ai-limits" className="scroll-mt-20" />
      <CardHeader title="AI limits for this person" subtitle="Overrides the defaults from Settings for this person, in every group." />
      <CardBody>
        <AiOverrideForm
          subject="person"
          disabled={user.aiDisabled}
          dailyLimit={user.aiDailyLimit}
          reason={user.aiReason}
          defaultLimitText={defaultLimitText}
          rightNow={rightNow}
          usage={<TodayLine user={user} />}
          pending={saving}
          onSave={onSave}
        />
      </CardBody>
    </Card>
  );
}
