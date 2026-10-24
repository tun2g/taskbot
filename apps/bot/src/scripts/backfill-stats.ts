/**
 * One-off: fills stats_daily.tasksCreated / tasksCompleted for every past day from tasks + task_activities,
 * so the admin charts have history from before usage tracking was deployed. Other fields stay 0 on new rows;
 * days that already have rows from real tracking keep everything except these two fields (recomputed the
 * same way the nightly rollup does). Safe to re-run.
 *
 *   pnpm --filter @tbot/bot backfill:stats            # all days before today (UTC)
 *   pnpm --filter @tbot/bot backfill:stats 2026-10-01 # only days before 2026-10-01
 */
import 'dotenv/config';

import mongoose from 'mongoose';
import { mongodbConnection } from 'src/database/connection';
import { backfillTaskStats, utcDay } from 'src/shared/services/stats/daily-stats';

async function main() {
  const before = process.argv[2] || utcDay(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error(`Expected a day like 2026-10-01, got "${before}"`);
  await mongodbConnection.ensureConnection();
  const { days, rows } = await backfillTaskStats(before);
  console.log(`Backfilled task counts for ${days} days before ${before} (${rows} rows upserted).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
    // Redis/Bull clients opened by shared imports would keep the process alive.
    process.exit(process.exitCode ?? 0);
  });
