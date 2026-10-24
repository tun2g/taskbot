import { UsageEvent } from '@tbot/db';
import type { AdminRunJobResult, AdminSystemStatus } from '@tbot/shared';
import { backgroundJobInfo } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { writeAudit } from 'src/shared/audit';
import { asyncHandler, parseOr400 } from 'src/shared/http';
import { getKv } from 'src/shared/redis';
import { loadBotRuntime } from 'src/shared/runtime';
import { activityNow, adminApiVersion, timed } from 'src/system/health';
import { listJobFailures, runJobNow } from 'src/system/job-runs';
import { QueueReport, readQueue } from 'src/system/queue';

// Callers and tests import the queue helpers from here.
export { BOT_QUEUE_NAME, readQueue, setBotQueue, summariseJobs } from 'src/system/queue';
export type { QueueReport } from 'src/system/queue';

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
      UsageEvent.findOne()
        .sort({ createdAt: -1 })
        .select('createdAt')
        .lean<{ createdAt: Date }>()
        .catch(() => null),
    ]);
    const [report, activity, runtime] = await Promise.all([
      redis.ok ? readQueue(now.getTime()) : Promise.resolve<QueueReport>({ queue: null, jobs: [] }),
      mongo.ok ? activityNow(now).catch(() => null) : Promise.resolve(null),
      mongo.ok ? loadBotRuntime() : Promise.resolve(null),
    ]);

    const body: AdminSystemStatus = {
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
    res.json({ data: body });
  }),
);

const jobQuery = z.object({
  name: z.string().max(100).optional(),
  cron: z.string().max(100).optional(),
});

// GET /system/jobs/failures?name=&cron= — the failed runs (last 24 h) behind a "Failures" number.
systemRouter.get(
  '/jobs/failures',
  asyncHandler(async (req: Request, res: Response) => {
    const { name, cron } = parseOr400(jobQuery, req.query);
    res.json({ data: await listJobFailures(name, cron) });
  }),
);

const runSchema = z.object({
  name: z.string({ message: 'Say which job to run.' }).min(1).max(100),
  cron: z.string().max(100).nullable(),
});

// POST /system/jobs/run { name, cron } — queue one run of a scheduled job now (the bot runs it within seconds).
systemRouter.post(
  '/jobs/run',
  asyncHandler(async (req: Request, res: Response) => {
    const { name, cron } = parseOr400(runSchema, req.body);
    await runJobNow(name, cron);
    const info = backgroundJobInfo(name, cron);
    await writeAudit(req, {
      action: 'system.job.run',
      targetType: 'system',
      targetId: `${name}|${cron ?? ''}`,
      targetLabel: info.label,
      details: { name, cron },
    });
    const body: AdminRunJobResult = { queuedAt: new Date().toISOString() };
    res.json({ data: body });
  }),
);
