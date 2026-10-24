import type { AdminSystemStatus } from '@tbot/shared';
import { useState } from 'react';

import { ErrorState, Notice, PageSkeleton } from '@/components/ui/states';
import { RelativeTime } from '@/components/ui/values';

import { HealthCards } from './components/health-cards';
import { JobFailuresDialog } from './components/job-failures-dialog';
import { JobsCard } from './components/jobs-card';
import { QueueCard } from './components/queue-card';
import { RunJobDialog } from './components/run-job-dialog';
import { SystemHeader } from './components/system-header';
import { telegramStalled } from './lib/bot-activity';
import type { JobRef } from './lib/job-schedule';

function Problems({ data: d, stalled }: { data: AdminSystemStatus; stalled: boolean }) {
  return (
    <>
      {(!d.mongo.ok || !d.redis.ok) && (
        <Notice tone="warn">
          {!d.mongo.ok ? 'The database is not responding — the bot can’t read or save tasks. ' : ''}
          {!d.redis.ok
            ? 'The cache is not responding — sessions, rate limits and scheduled jobs (reminders, digests) are affected.'
            : ''}
        </Notice>
      )}
      {stalled && (
        <Notice tone="warn">
          Nothing has come in from Telegram chats for over 6 hours, while the Mini App and MCP are in use. Telegram
          messages may not be reaching the bot — check the bot’s webhook and logs.
        </Notice>
      )}
    </>
  );
}

export function SystemContent(props: {
  data: AdminSystemStatus | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  updatedAt: number;
}) {
  // undefined = closed; null = every job's failures.
  const [failuresOf, setFailuresOf] = useState<JobRef | null | undefined>(undefined);
  const [runJob, setRunJob] = useState<JobRef | null>(null);

  const header = <SystemHeader updatedAt={props.updatedAt} checking={props.retrying} onCheck={props.onRetry} />;
  if (props.isLoading)
    return (
      <>
        {header}
        <PageSkeleton />
      </>
    );
  if (props.error || !props.data)
    return (
      <>
        {header}
        <ErrorState
          title="Couldn’t check the system."
          message={`${props.error ?? 'No data.'} The admin API itself may be down — the bot can still be running.`}
          onRetry={props.onRetry}
          retrying={props.retrying}
        />
      </>
    );

  const d = props.data;
  const stalled = telegramStalled(d.lastEventByChannel);
  return (
    <>
      {header}
      <div className="space-y-4">
        <Problems data={d} stalled={stalled} />
        <HealthCards data={d} telegramStalled={stalled} />
        <QueueCard queue={d.queue} scheduledJobs={d.jobs.length} onOpenFailures={() => setFailuresOf(null)} />
        <JobsCard jobs={d.jobs} queueReachable={!!d.queue} onOpenFailures={setFailuresOf} onRun={setRunJob} />
        <p className="text-[13px] text-text-3">
          {d.bot?.startedAt ? (
            <>
              Bot started <RelativeTime value={d.bot.startedAt} /> (it reports this when it starts; a restart resets
              it).
            </>
          ) : (
            'The bot hasn’t reported when it started yet — it does on its next start.'
          )}
        </p>
      </div>
      <JobFailuresDialog
        open={failuresOf !== undefined}
        job={failuresOf ?? null}
        onClose={() => setFailuresOf(undefined)}
        onRun={(job) => {
          setFailuresOf(undefined);
          setRunJob(job);
        }}
      />
      <RunJobDialog job={runJob} onClose={() => setRunJob(null)} />
    </>
  );
}
