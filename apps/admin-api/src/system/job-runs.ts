import type { AdminJobFailures } from '@tbot/shared';
import { HttpError } from 'src/shared/http';
import logger from 'src/shared/logger';
import { botQueue, BullJobLike, cronOf, DAY_MS, RepeatableIn, withTimeout } from 'src/system/queue';

/** Same schedule? A run without a known schedule (older history) belongs to every schedule of its name. */
const sameSchedule = (jobCron: string | null, cron: string | null | undefined) => !cron || !jobCron || jobCron === cron;

const unreachable = (what: string) =>
  new HttpError(503, `The job queue can’t be reached right now, so ${what}. Check the cache (Redis).`);

/** The failed runs (last 24 h) of one schedule — or of every job — newest first, plus when it runs again. */
export async function listJobFailures(
  name: string | undefined,
  cron: string | undefined,
  now = Date.now(),
): Promise<AdminJobFailures> {
  let failed: BullJobLike[];
  let repeatable: RepeatableIn[];
  try {
    const q = botQueue();
    [failed, repeatable] = await withTimeout(
      Promise.all([
        q.getFailed(0, 199) as unknown as Promise<BullJobLike[]>,
        q.getRepeatableJobs() as Promise<RepeatableIn[]>,
      ]),
    );
  } catch (err) {
    logger.warn(`Couldn't read failed jobs: ${err}`);
    throw unreachable('failures can’t be listed');
  }
  const mine = failed
    .filter((j): j is NonNullable<BullJobLike> => !!j)
    .filter((j) => !name || (j.name === name && sameSchedule(cronOf(j), cron)))
    .sort((a, b) => (b.finishedOn ?? 0) - (a.finishedOn ?? 0));
  const recent = mine.filter((j) => (j.finishedOn ?? 0) > now - DAY_MS);
  const next = name
    ? repeatable
        .filter((r) => r.name === name && sameSchedule(r.cron ?? r.pattern ?? null, cron))
        .map((r) => r.next ?? 0)
    : [];
  const nextAt = next.filter((n) => n > 0).sort((a, b) => a - b)[0];
  return {
    job: name ? { name, cron: cron ?? null } : null,
    nextRunAt: nextAt ? new Date(nextAt).toISOString() : null,
    failures: recent.map((j) => ({
      id: String(j.id ?? ''),
      name: j.name,
      cron: cronOf(j),
      at: new Date(j.finishedOn ?? j.timestamp ?? 0).toISOString(),
      error: String(j.failedReason || 'Failed without an error message').slice(0, 1000),
      attempt: Math.max(1, j.attemptsMade ?? 1),
    })),
    olderKept: mine.length - recent.length,
  };
}

/**
 * Queues one run of a job the bot has scheduled (nothing arbitrary can be queued), with the same input as its
 * scheduled runs (e.g. stats-rollup's mode). The bot picks it up within seconds.
 */
export async function runJobNow(name: string, cron: string | null): Promise<void> {
  const q = botQueue();
  let repeatable: RepeatableIn[];
  let delayed: BullJobLike[];
  try {
    [repeatable, delayed] = await withTimeout(
      Promise.all([
        q.getRepeatableJobs() as Promise<RepeatableIn[]>,
        q.getDelayed(0, 199) as unknown as Promise<BullJobLike[]>,
      ]),
    );
  } catch (err) {
    logger.warn(`Couldn't read the job queue: ${err}`);
    throw unreachable('the job can’t be started');
  }
  if (!repeatable.some((r) => r.name === name && (r.cron ?? r.pattern ?? null) === cron)) {
    throw new HttpError(404, 'This job isn’t scheduled by the bot (any more). Refresh the page.');
  }
  const scheduled = delayed.find((j) => j && j.name === name && j.opts?.repeat?.cron === cron);
  const data = { ...(scheduled?.data ?? {}), schedule: cron, ranFromAdmin: true };
  try {
    await withTimeout(q.add(name, data, { removeOnComplete: 200, removeOnFail: 200 }));
  } catch (err) {
    logger.warn(`Couldn't queue ${name}: ${err}`);
    throw new HttpError(503, 'The job couldn’t be queued: the cache (Redis) didn’t answer. Try again in a minute.');
  }
}
