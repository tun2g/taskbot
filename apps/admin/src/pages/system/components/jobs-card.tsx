import { backgroundJobInfo } from '@tbot/shared';

import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { STACK_ON_MOBILE } from '@/components/ui/table-stack';
import { Table, Th, THead } from '@/components/ui/table';

import { type JobRef, jobRef, type JobRow as Job, nextRunSentence } from '../lib/job-schedule';
import { JobRow } from './job-row';

/** What happens next, in the card's subtitle: which job failed and when it retries on its own. */
function subtitle(jobs: Job[]): string {
  const failing = jobs.filter((j) => j.lastError);
  if (failing.length === 0) return 'Recurring work the bot runs on its own. Times are UTC.';
  if (failing.length === 1) {
    const j = failing[0]!;
    const retry = nextRunSentence(j.nextRunAt, 'Retries automatically');
    return `“${backgroundJobInfo(j.name, j.cron).label}” failed on its last run. ${retry ?? 'It retries at its next scheduled time.'} Or press “Run now” once the cause is fixed.`;
  }
  return `${failing.length} jobs failed on their last run. Each retries automatically at its next scheduled time (shown under “Checks”), or press “Run now”.`;
}

export function JobsCard({
  jobs,
  queueReachable,
  onOpenFailures,
  onRun,
}: {
  jobs: Job[];
  queueReachable: boolean;
  onOpenFailures: (job: JobRef) => void;
  onRun: (job: JobRef) => void;
}) {
  return (
    <Card>
      <CardHeader title="Scheduled jobs" subtitle={subtitle(jobs)} />
      {jobs.length === 0 ? (
        <EmptyState
          compact
          title={
            queueReachable
              ? 'No scheduled jobs are registered.'
              : 'Scheduled jobs can’t be read while the queue is unreachable.'
          }
          body={
            queueReachable
              ? 'The bot registers them when it starts — if this stays empty, the bot may not be running.'
              : undefined
          }
        />
      ) : (
        <Table className={STACK_ON_MOBILE}>
          <THead>
            <Th>Job</Th>
            <Th>Checks</Th>
            <Th>Last run</Th>
            <Th hint="Only recent runs are remembered">Last success</Th>
            <Th align="right" hint="last 24 h">
              Failures
            </Th>
            <Th />
          </THead>
          <tbody>
            {jobs.map((j) => (
              <JobRow
                key={j.key ?? `${j.name}|${j.cron}`}
                job={j}
                onOpenFailures={() => onOpenFailures(jobRef(j))}
                onRun={() => onRun(jobRef(j))}
              />
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
