import type { AdminJobFailure } from '@tbot/shared';
import { backgroundJobInfo } from '@tbot/shared';

import { useJobFailures } from '@/api/system';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { RelativeTime } from '@/components/ui/values';
import { getErrorMessage } from '@/lib/api-client';
import { formatDateTimeUtc, plural } from '@/lib/format';

import { type JobRef, nextRunSentence } from '../lib/job-schedule';

function FailureItem({ failure: f, showJob }: { failure: AdminJobFailure; showJob: boolean }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium text-text">
          {showJob ? backgroundJobInfo(f.name, f.cron).label : <RelativeTime value={f.at} />}
        </span>
        <span className="text-[13px] text-text-3">
          {formatDateTimeUtc(f.at)} · {f.attempt === 1 ? 'first try' : `try ${f.attempt}`}
        </span>
      </div>
      {showJob && (
        <div className="text-[13px] text-text-3">
          <RelativeTime value={f.at} />
        </div>
      )}
      <p className="mt-1 rounded-md bg-danger-soft px-2 py-1.5 font-mono text-[13px] break-words text-danger">
        {f.error}
      </p>
    </li>
  );
}

/** The failed runs behind a "Failures" number: when, which try, and the error — plus what happens next. */
export function JobFailuresDialog({
  open,
  job,
  onClose,
  onRun,
}: {
  open: boolean;
  /** null = every job (the queue's "Failed (last 24 h)"). */
  job: JobRef | null;
  onClose: () => void;
  onRun: (job: JobRef) => void;
}) {
  const failures = useJobFailures(job, open);
  const d = failures.data;
  const title = job
    ? `Failed runs of “${backgroundJobInfo(job.name, job.cron).label}”`
    : 'Failed jobs in the last 24 hours';
  const next = nextRunSentence(d?.nextRunAt, 'Retries automatically');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {job && (
            <Button variant="primary" onClick={() => onRun(job)}>
              Run now
            </Button>
          )}
        </>
      }
    >
      {failures.isLoading ? (
        <TableSkeleton rows={3} />
      ) : failures.isError || !d ? (
        <ErrorState
          title="Couldn’t load the failed runs"
          message={getErrorMessage(failures.error)}
          onRetry={() => void failures.refetch()}
          retrying={failures.isFetching}
        />
      ) : d.failures.length === 0 ? (
        <EmptyState compact title="No failures in the last 24 hours." body={next ?? undefined} />
      ) : (
        <>
          <p className="text-[15px] text-text-2">
            {plural(d.failures.length, 'failed run')} in the last 24 hours, newest first.{' '}
            {job ? (next ?? 'It retries at its next scheduled time.') : 'Each job retries at its next scheduled time.'}
          </p>
          <ul className="mt-1 divide-y divide-border">
            {d.failures.map((f) => (
              <FailureItem key={`${f.id}-${f.at}`} failure={f} showJob={!job} />
            ))}
          </ul>
          {d.olderKept > 0 && (
            <p className="mt-2 text-[13px] text-text-3">
              {plural(d.olderKept, 'older failure')} from before that are still kept in the history.
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
