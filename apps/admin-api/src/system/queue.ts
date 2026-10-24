import type { AdminSystemStatus } from '@tbot/shared';
import Bull from 'bull';
import { config } from 'src/config/configuration';
import logger from 'src/shared/logger';

/**
 * The bot's Bull queue. No processors are registered here, so this process never runs jobs; it reads the queue
 * and can add one run of a scheduled job ("Run now"), which the bot then picks up.
 */
export const BOT_QUEUE_NAME = 'task-management';

const TIMEOUT_MS = 3000;

export function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);
}

let queue: Bull.Queue | null = null;
export function botQueue(): Bull.Queue {
  if (!queue) {
    const { host, port, database } = config.redis;
    queue = new Bull(BOT_QUEUE_NAME, { redis: { host, port, db: database, maxRetriesPerRequest: 1 } });
    queue.on('error', (err) => logger.warn(`Queue stats error: ${err}`));
  }
  return queue;
}

/** Tests: replace the queue. */
export function setBotQueue(q: Bull.Queue | null) {
  queue = q;
}

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

const finishedRows = (list: BullJobLike[]) =>
  list
    .filter((j): j is NonNullable<BullJobLike> => !!j)
    .map((j) => ({ name: j.name, finishedOn: j.finishedOn, cron: cronOf(j), failedReason: j.failedReason }));

/** Queue counts and scheduled jobs (null queue = the queue couldn't be read). */
export async function readQueue(now = Date.now()): Promise<QueueReport> {
  try {
    const q = botQueue();
    const [counts, repeatable, completed, failed, waiting] = await withTimeout(
      Promise.all([
        q.getJobCounts(),
        q.getRepeatableJobs(),
        q.getCompleted(0, 199),
        q.getFailed(0, 199),
        q.getWaiting ? q.getWaiting(0, 0).catch(() => []) : Promise.resolve([]),
      ]),
    );
    const failedList = finishedRows(failed as unknown as BullJobLike[]);
    const oldest = (waiting as unknown as BullJobLike[])[0]?.timestamp;
    return {
      queue: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failedLast24h: failedList.filter((j) => (j.finishedOn ?? 0) > now - DAY_MS).length,
        oldestWaitingSeconds: oldest ? Math.max(0, Math.round((now - oldest) / 1000)) : null,
      },
      jobs: summariseJobs(
        repeatable as RepeatableIn[],
        finishedRows(completed as unknown as BullJobLike[]),
        failedList,
        now,
      ),
    };
  } catch (err) {
    logger.warn(`Couldn't read queue stats: ${err}`);
    return { queue: null, jobs: [] };
  }
}
