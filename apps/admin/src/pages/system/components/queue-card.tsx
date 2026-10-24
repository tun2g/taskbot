import type { AdminSystemStatus } from '@tbot/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { formatNumber, formatSince } from '@/lib/format';

import { STUCK_SECONDS } from '../lib/bot-activity';

type Queue = NonNullable<AdminSystemStatus['queue']>;
interface Cell {
  key: string;
  label: string;
  value: number;
  bad: boolean;
  hint: string;
  /** Opens the list behind the number. */
  onOpen?: () => void;
}

function queueCells(q: Queue, scheduledJobs: number, onOpenFailures: () => void): Cell[] {
  const failed24h = q.failedLast24h ?? q.failed;
  const stuck = (q.oldestWaitingSeconds ?? 0) > STUCK_SECONDS;
  return [
    {
      key: 'waiting',
      label: 'Waiting',
      value: q.waiting,
      bad: stuck,
      hint: stuck
        ? `The oldest has waited ${formatSince(new Date(Date.now() - (q.oldestWaitingSeconds ?? 0) * 1000))} — nothing is processing jobs. Restart the bot.`
        : 'Due now, about to start. Normally 0, or a few for a moment on the hour.',
    },
    { key: 'active', label: 'Running', value: q.active, bad: false, hint: 'Being processed right now. Normally 0–3.' },
    {
      key: 'delayed',
      label: 'Scheduled',
      value: q.delayed,
      bad: false,
      hint: `The next run of each scheduled job (${formatNumber(scheduledJobs)} below), plus retries. This is normal.`,
    },
    {
      key: 'failed',
      label: q.failedLast24h != null ? 'Failed (last 24 h)' : 'Failed (kept)',
      value: failed24h,
      bad: failed24h > 0,
      hint:
        failed24h > 0
          ? 'See when, which job and the error →'
          : q.failedLast24h != null && q.failed > 0
            ? `None recently. ${formatNumber(q.failed)} older failures are kept in the history.`
            : 'Normally 0.',
      onOpen: failed24h > 0 ? onOpenFailures : undefined,
    },
  ];
}

function QueueCell({ cell: c }: { cell: Cell }) {
  const body = (
    <>
      <div className="text-[13px] font-medium text-text-2">{c.label}</div>
      <div className={cn('mt-0.5 text-lg font-semibold tabular', c.bad ? 'text-danger' : 'text-text')}>
        {formatNumber(c.value)}
      </div>
      <div className={cn('mt-0.5 text-[13px]', c.onOpen ? 'text-accent-text' : 'text-text-3')}>{c.hint}</div>
    </>
  );
  if (!c.onOpen) return <div className="bg-surface px-5 py-3">{body}</div>;
  return (
    <button
      type="button"
      onClick={c.onOpen}
      className="block h-full w-full cursor-pointer bg-surface px-5 py-3 text-left transition-colors hover:bg-brand-soft/60"
    >
      {body}
    </button>
  );
}

/** Queue counts; "Failed (last 24 h)" opens the failed runs. */
export function QueueCard({
  queue: q,
  scheduledJobs,
  onOpenFailures,
}: {
  queue: Queue | null;
  scheduledJobs: number;
  onOpenFailures: () => void;
}) {
  const failed24h = q ? (q.failedLast24h ?? q.failed) : 0;
  const stuck = !!q && (q.oldestWaitingSeconds ?? 0) > STUCK_SECONDS;
  return (
    <Card>
      <CardHeader
        title="Job queue"
        subtitle="Background work (reminders, digests, dashboard numbers) waits here until the bot runs it."
        action={
          q && (
            <Badge tone={stuck || failed24h > 0 ? 'danger' : 'good'}>
              {stuck ? 'Stuck' : failed24h > 0 ? 'Failures' : 'Healthy'}
            </Badge>
          )
        }
      />
      {q ? (
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          {queueCells(q, scheduledJobs, onOpenFailures).map((c) => (
            <QueueCell key={c.key} cell={c} />
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          title="The job queue can’t be reached."
          body="Reminders, digests and your Telegram alerts won’t run until the cache (Redis) is back."
        />
      )}
    </Card>
  );
}
