import type { AdminOverview } from '@tbot/shared';

import { TextLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max > 0 ? value / max : 0;
  const tone = share >= 1 ? 'bg-danger' : share >= 0.8 ? 'bg-warn' : 'bg-accent';
  return (
    <div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
    </div>
  );
}

/** Today's AI spend against the daily budget and call limit from Settings. */
export function AiTodayCard({ today }: { today: AdminOverview['aiToday'] }) {
  const { costUsd, calls, budgetUsd, callLimit, blocked = 0 } = today;
  const budgetShare = budgetUsd ? costUsd / budgetUsd : null;
  return (
    <Card className="h-full">
      <CardHeader
        title="AI today"
        subtitle="Since midnight UTC. The call limit stops AI for the rest of the day; the budget only sends you alerts."
        action={
          <TextLink to="/ai" search={{ range: '7d', groupBy: 'day' }} className="text-sm">
            Details →
          </TextLink>
        }
      />
      <CardBody className="space-y-4">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <span className="text-2xl font-semibold text-text tabular">{formatMoney(costUsd)}</span>
            <span className="text-[13px] text-text-3 tabular">
              {budgetUsd != null ? `of ${formatMoney(budgetUsd)} daily budget` : 'No daily budget set'}
            </span>
          </div>
          {budgetUsd != null ? (
            <>
              <div className="mt-2">
                <Meter value={costUsd} max={budgetUsd} label="Today’s estimated AI cost against the daily budget" />
              </div>
              <p className="mt-1.5 text-[13px] text-text-3">
                {budgetShare != null && budgetShare >= 1
                  ? 'Budget reached. AI keeps working — set a daily call limit in Settings to stop spending.'
                  : `${formatPercent(budgetShare ?? 0)} of the budget used.`}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[13px] text-text-3">
              No budget, so you won’t get spend alerts.{' '}
              <TextLink to="/settings">Set a budget</TextLink>
            </p>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <span className="text-base font-semibold text-text tabular">{formatNumber(calls)} calls</span>
            <span className="text-[13px] text-text-3 tabular">
              {callLimit != null ? `of ${formatNumber(callLimit)} daily limit` : 'No daily call limit'}
            </span>
          </div>
          {callLimit != null && (
            <div className="mt-2">
              <Meter value={calls} max={callLimit} label="Today’s AI calls against the daily call limit" />
            </div>
          )}
          {callLimit != null && calls >= callLimit ? (
            <p className="mt-1.5 text-[13px] text-danger">
              Daily limit reached — AI is stopped for everyone until midnight UTC
              {blocked > 0 ? ` (${formatNumber(blocked)} ${blocked === 1 ? 'request' : 'requests'} refused so far)` : ''}.{' '}
              <TextLink to="/ai" search={{ range: '7d', status: 'quota' }}>
                See them
              </TextLink>
            </p>
          ) : (
            blocked > 0 && (
              // Below the global limit, refusals come from a group's / person's own limit or from AI being turned off for them.
              <p className="mt-1.5 text-[13px] text-text-2">
                {formatNumber(blocked)} {blocked === 1 ? 'request was' : 'requests were'} refused today by a group’s or
                person’s own AI limit, or because you turned AI off for them. These aren’t counted above.{' '}
                <TextLink to="/ai" search={{ range: '7d', status: 'quota' }}>
                  See limit refusals
                </TextLink>
              </p>
            )
          )}
        </div>
      </CardBody>
    </Card>
  );
}
