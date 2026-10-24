import { UsageEvent } from '@tbot/db';
import Bull from 'bull';
import mongoose from 'mongoose';
import { config } from 'src/config/configuration';
import { BullJobLike, RepeatableIn } from 'src/modules/system/helpers/jobs';
import { withTimeout } from 'src/modules/system/helpers/timeout';
import logger from 'src/shared/logger';
import { getKv } from 'src/shared/redis';

/**
 * The bot's Bull queue. No processors are registered here, so this process never runs jobs; it reads the queue
 * and can add one run of a scheduled job ("Run now"), which the bot then picks up.
 */
export const BOT_QUEUE_NAME = 'task-management';

let queue: Bull.Queue | null = null;
function botQueue(): Bull.Queue {
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

/** Job counts, schedules, the last 200 completed / failed runs and the oldest waiting job (times out after 3 s). */
export async function readQueueSnapshot() {
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
  return {
    counts,
    repeatable: repeatable as RepeatableIn[],
    completed: completed as unknown as BullJobLike[],
    failed: failed as unknown as BullJobLike[],
    waiting: waiting as unknown as BullJobLike[],
  };
}

/** The last 200 failed runs and the schedules (times out after 3 s). */
export async function readFailedAndSchedules(): Promise<[BullJobLike[], RepeatableIn[]]> {
  const q = botQueue();
  return withTimeout(
    Promise.all([
      q.getFailed(0, 199) as unknown as Promise<BullJobLike[]>,
      q.getRepeatableJobs() as Promise<RepeatableIn[]>,
    ]),
  );
}

/** The schedules and the next 200 delayed (scheduled) runs (times out after 3 s). */
export async function readSchedulesAndDelayed(): Promise<[RepeatableIn[], BullJobLike[]]> {
  const q = botQueue();
  return withTimeout(
    Promise.all([
      q.getRepeatableJobs() as Promise<RepeatableIn[]>,
      q.getDelayed(0, 199) as unknown as Promise<BullJobLike[]>,
    ]),
  );
}

/** Adds one run of a job to the queue (times out after 3 s). */
export async function addJobRun(name: string, data: Record<string, unknown>): Promise<void> {
  await withTimeout(botQueue().add(name, data, { removeOnComplete: 200, removeOnFail: 200 }));
}

export async function pingMongo(): Promise<void> {
  if (!mongoose.connection.db) throw new Error('not connected');
  await mongoose.connection.db.admin().ping();
}

export function pingRedis(): Promise<unknown> {
  return getKv().ping();
}

/** The newest usage event (null when there's none or Mongo can't be read). */
export function lastUsageEvent(): Promise<{ createdAt: Date } | null> {
  return UsageEvent.findOne()
    .sort({ createdAt: -1 })
    .select('createdAt')
    .lean<{ createdAt: Date }>()
    .catch(() => null);
}

/** Events since `since`, events in these windows, and the last event per channel since `channelsSince`. */
export async function usageActivity(since: Date, windows: { createdAt: { $gte: Date; $lt: Date } }[], channelsSince: Date) {
  const [lastHour, usual, byChannel] = await Promise.all([
    UsageEvent.countDocuments({ createdAt: { $gte: since } }),
    UsageEvent.countDocuments({ $or: windows }),
    UsageEvent.aggregate([
      { $match: { createdAt: { $gte: channelsSince } } },
      { $group: { _id: '$channel', at: { $max: '$createdAt' } } },
    ]),
  ]);
  return { lastHour, usual, byChannel: byChannel as { _id: string | null; at: Date | null }[] };
}
