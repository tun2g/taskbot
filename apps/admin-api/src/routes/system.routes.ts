import { UsageEvent } from '@tbot/db';
import type { AdminSystemStatus, UsageChannel } from '@tbot/shared';
import Bull from 'bull';
import { Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'src/config/configuration';
import { asyncHandler } from 'src/shared/http';
import logger from 'src/shared/logger';
import { getKv } from 'src/shared/redis';

/** The bot's Bull queue (read-only here: no processors are registered, so this process never runs jobs). */
export const BOT_QUEUE_NAME = 'task-management';

const TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);
}

async function timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; latencyMs: number | null }> {
  const t0 = Date.now();
  try {
    await withTimeout(fn());
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

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

type JobRow = AdminSystemStatus['jobs'][number];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface RepeatableIn {
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
export function summariseJobs(repeatable: RepeatableIn[], completed: FinishedIn[], failed: FailedIn[], now = Date.now()): JobRow[] {
  const seen = new Set<string>();
  const out: JobRow[] = [];
  for (const r of repeatable) {
    const cron = r.cron ?? r.pattern ?? null;
    const key = `${r.name}|${cron ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = <T extends FinishedIn>(list: T[]) => list.filter((j) => j.name === r.name && (!j.cron || !cron || j.cron === cron));
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
      lastError: lastFail && failTime > lastOk ? String(lastFail.failedReason || 'Failed without an error message').slice(0, 300) : null,
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

type BullJobLike = {
  name: string;
  finishedOn?: number | null;
  failedReason?: string;
  timestamp?: number;
  opts?: { repeat?: { cron?: string } };
} | null;

const finishedRows = (list: BullJobLike[]) =>
  list
    .filter((j): j is NonNullable<BullJobLike> => !!j)
    .map((j) => ({ name: j.name, finishedOn: j.finishedOn, cron: j.opts?.repeat?.cron ?? null, failedReason: j.failedReason }));

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
      jobs: summariseJobs(repeatable as RepeatableIn[], finishedRows(completed as unknown as BullJobLike[]), failedList, now),
    };
  } catch (err) {
    logger.warn(`Couldn't read queue stats: ${err}`);
    return { queue: null, jobs: [] };
  }
}

/** Requests in the last hour, the average for the same clock hour over the previous 7 days, and the last event per channel. */
async function activityNow(now: Date) {
  const t = now.getTime();
  const sameHour = Array.from({ length: 7 }, (_, i) => ({
    createdAt: { $gte: new Date(t - (i + 1) * DAY_MS - HOUR_MS), $lt: new Date(t - (i + 1) * DAY_MS) },
  }));
  const [lastHour, usual, byChannel] = await Promise.all([
    UsageEvent.countDocuments({ createdAt: { $gte: new Date(t - HOUR_MS) } }),
    UsageEvent.countDocuments({ $or: sameHour }),
    UsageEvent.aggregate([{ $match: { createdAt: { $gte: new Date(t - 7 * DAY_MS) } } }, { $group: { _id: '$channel', at: { $max: '$createdAt' } } }]),
  ]);
  const lastByChannel: Partial<Record<UsageChannel, string>> = {};
  for (const c of byChannel as { _id: UsageChannel | null; at: Date | null }[]) if (c._id && c.at) lastByChannel[c._id] = new Date(c.at).toISOString();
  return { lastHour, usualThisHour: Math.round((usual / 7) * 10) / 10, lastByChannel };
}

let version: string | null = null;
function adminApiVersion(): string {
  if (version) return version;
  try {
    version = process.env.APP_VERSION || (JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')).version as string);
  } catch {
    version = 'unknown';
  }
  return version;
}

export const systemRouter: Router = Router();

systemRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();
    const [mongo, redis, lastEvent] = await Promise.all([
      timed(async () => {
        if (!mongoose.connection.db) throw new Error('not connected');
        await mongoose.connection.db.admin().ping();
      }),
      timed(() => getKv().ping()),
      UsageEvent.findOne().sort({ createdAt: -1 }).select('createdAt').lean<{ createdAt: Date }>().catch(() => null),
    ]);
    const [report, activity] = await Promise.all([
      redis.ok ? readQueue(now.getTime()) : Promise.resolve<QueueReport>({ queue: null, jobs: [] }),
      mongo.ok ? activityNow(now).catch(() => null) : Promise.resolve(null),
    ]);

    const body: AdminSystemStatus = {
      mongo,
      redis,
      queue: report.queue,
      jobs: report.jobs,
      lastEventAt: lastEvent ? new Date(lastEvent.createdAt).toISOString() : null,
      ...(activity
        ? { lastEventByChannel: activity.lastByChannel, activity: { lastHour: activity.lastHour, usualThisHour: activity.usualThisHour } }
        : {}),
      versions: { adminApi: adminApiVersion() },
    };
    res.json({ data: body });
  }),
);
