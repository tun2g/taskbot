import type { AdminSystemStatus, UsageChannel } from '@tbot/shared';
import { DAY_MS, finishedRows, QueueReport, summariseJobs } from 'src/modules/system/helpers/jobs';
import { withTimeout } from 'src/modules/system/helpers/timeout';
import { adminApiVersion } from 'src/modules/system/helpers/version';
import { lastUsageEvent, pingMongo, pingRedis, readQueueSnapshot, usageActivity } from 'src/modules/system/system.repository';
import logger from 'src/shared/logger';
import { loadBotRuntime } from 'src/shared/runtime';

const HOUR_MS = 60 * 60 * 1000;

/** Ping with a latency, never throwing. */
export async function timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; latencyMs: number | null }> {
  const t0 = Date.now();
  try {
    await withTimeout(fn());
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

/** Requests in the last hour, the average for the same clock hour over the previous 7 days, and the last event per channel. */
export async function activityNow(now: Date) {
  const t = now.getTime();
  const sameHour = Array.from({ length: 7 }, (_, i) => ({
    createdAt: { $gte: new Date(t - (i + 1) * DAY_MS - HOUR_MS), $lt: new Date(t - (i + 1) * DAY_MS) },
  }));
  const { lastHour, usual, byChannel } = await usageActivity(new Date(t - HOUR_MS), sameHour, new Date(t - 7 * DAY_MS));
  const lastByChannel: Partial<Record<UsageChannel, string>> = {};
  for (const c of byChannel as { _id: UsageChannel | null; at: Date | null }[])
    if (c._id && c.at) lastByChannel[c._id] = new Date(c.at).toISOString();
  return { lastHour, usualThisHour: Math.round((usual / 7) * 10) / 10, lastByChannel };
}

/** Queue counts and scheduled jobs (null queue = the queue couldn't be read). */
export async function readQueue(now = Date.now()): Promise<QueueReport> {
  try {
    const { counts, repeatable, completed, failed, waiting } = await readQueueSnapshot();
    const failedList = finishedRows(failed);
    const oldest = waiting[0]?.timestamp;
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
      jobs: summariseJobs(repeatable, finishedRows(completed), failedList, now),
    };
  } catch (err) {
    logger.warn(`Couldn't read queue stats: ${err}`);
    return { queue: null, jobs: [] };
  }
}

/** GET /system — Mongo / Redis health, the job queue and schedules, recent activity and versions. */
export async function systemStatus(): Promise<AdminSystemStatus> {
  const now = new Date();
  const [mongo, redis, lastEvent] = await Promise.all([timed(pingMongo), timed(pingRedis), lastUsageEvent()]);
  const [report, activity, runtime] = await Promise.all([
    redis.ok ? readQueue(now.getTime()) : Promise.resolve<QueueReport>({ queue: null, jobs: [] }),
    mongo.ok ? activityNow(now).catch(() => null) : Promise.resolve(null),
    mongo.ok ? loadBotRuntime() : Promise.resolve(null),
  ]);

  return {
    mongo,
    redis,
    queue: report.queue,
    jobs: report.jobs,
    lastEventAt: lastEvent ? new Date(lastEvent.createdAt).toISOString() : null,
    ...(activity
      ? {
          lastEventByChannel: activity.lastByChannel,
          activity: { lastHour: activity.lastHour, usualThisHour: activity.usualThisHour },
        }
      : {}),
    versions: { adminApi: adminApiVersion() },
    bot: { startedAt: runtime?.startedAt || null },
  };
}
