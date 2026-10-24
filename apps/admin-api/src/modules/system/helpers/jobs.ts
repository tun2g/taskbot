import type { AdminSystemStatus } from '@tbot/shared';

type JobRow = AdminSystemStatus['jobs'][number];

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface RepeatableIn {
  name: string;
  cron?: string | null;
  pattern?: string | null;
  next?: number | null;
}
interface FinishedIn {
  name: string;
  finishedOn?: number | null;
  /** The schedule the job ran on (Bull keeps it in job.opts.repeat.cron). */
  cron?: string | null;
}
interface FailedIn extends FinishedIn {
  failedReason?: string | null;
}

/**
 * One row per schedule (the same job name can run on two schedules, e.g. stats-rollup daily + hourly), with
 * its last run, last success, the latest error (only when the latest run failed) and failures in the last 24h.
 * A finished job without a known schedule counts for every schedule of that name.
 */
export function summariseJobs(
  repeatable: RepeatableIn[],
  completed: FinishedIn[],
  failed: FailedIn[],
  now = Date.now(),
): JobRow[] {
  const seen = new Set<string>();
  const out: JobRow[] = [];
  for (const r of repeatable) {
    const cron = r.cron ?? r.pattern ?? null;
    const key = `${r.name}|${cron ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = <T extends FinishedIn>(list: T[]) =>
      list.filter((j) => j.name === r.name && (!j.cron || !cron || j.cron === cron));
    const ok = mine(completed);
    const bad = mine(failed);
    const lastOk = Math.max(0, ...ok.map((j) => j.finishedOn ?? 0));
    const lastFail = [...bad].sort((a, b) => (b.finishedOn ?? 0) - (a.finishedOn ?? 0))[0];
    const failTime = lastFail?.finishedOn ?? 0;
    const lastRun = Math.max(lastOk, failTime);
    out.push({
      name: r.name,
      cron,
      lastRunAt: lastRun ? new Date(lastRun).toISOString() : null,
      lastError:
        lastFail && failTime > lastOk
          ? String(lastFail.failedReason || 'Failed without an error message').slice(0, 300)
          : null,
      key,
      lastSuccessAt: lastOk ? new Date(lastOk).toISOString() : null,
      failuresLast24h: bad.filter((j) => (j.finishedOn ?? 0) > now - DAY_MS).length,
      nextRunAt: r.next ? new Date(r.next).toISOString() : null,
    });
  }
  return out;
}

export interface QueueReport {
  queue: AdminSystemStatus['queue'];
  jobs: JobRow[];
}

export type BullJobLike = {
  id?: string | number;
  name: string;
  data?: Record<string, unknown> | null;
  finishedOn?: number | null;
  failedReason?: string;
  attemptsMade?: number;
  timestamp?: number;
  opts?: { repeat?: { cron?: string } };
} | null;

/** The schedule a job belongs to: Bull's repeat cron, or the one "Run now" recorded in its data. */
export const cronOf = (j: NonNullable<BullJobLike>): string | null =>
  j.opts?.repeat?.cron ?? (typeof j.data?.schedule === 'string' ? j.data.schedule : null);

export const finishedRows = (list: BullJobLike[]) =>
  list
    .filter((j): j is NonNullable<BullJobLike> => !!j)
    .map((j) => ({ name: j.name, finishedOn: j.finishedOn, cron: cronOf(j), failedReason: j.failedReason }));

/** Same schedule? A run without a known schedule (older history) belongs to every schedule of its name. */
export const sameSchedule = (jobCron: string | null, cron: string | null | undefined) => !cron || !jobCron || jobCron === cron;
