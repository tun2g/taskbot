import { Request, Response } from 'express';
import { jobQuery, runSchema } from 'src/modules/system/system.schemas';
import { listJobFailures, runJobFromAdmin, systemStatus } from 'src/modules/system/system.service';
import { parseOr400 } from 'src/shared/http';

// GET /system
export async function getStatus(_req: Request, res: Response) {
  res.json({ data: await systemStatus() });
}

// GET /system/jobs/failures?name=&cron= — the failed runs (last 24 h) behind a "Failures" number.
export async function getJobFailures(req: Request, res: Response) {
  const { name, cron } = parseOr400(jobQuery, req.query);
  res.json({ data: await listJobFailures(name, cron) });
}

// POST /system/jobs/run { name, cron } — queue one run of a scheduled job now (the bot runs it within seconds).
export async function postRunJob(req: Request, res: Response) {
  const { name, cron } = parseOr400(runSchema, req.body);
  res.json({ data: await runJobFromAdmin(req, name, cron) });
}
