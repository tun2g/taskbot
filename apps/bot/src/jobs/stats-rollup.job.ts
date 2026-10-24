import Bull from 'bull';
import { bot } from 'src/bot';
import { runAiAlerts } from 'src/jobs/ai-alerts';
import { remindOwnerOfPendingGroups } from 'src/jobs/pending-reminder';
import logger from 'src/shared/logger/logger';
import { addDays, rollupDay, utcDay } from 'src/shared/services/stats/daily-stats';
import { flushUsage } from 'src/shared/services/telemetry/usage-tracker';

/** 00:10 UTC: yesterday's final numbers (+ the first pass of today). */
export const STATS_ROLLUP_CRON = '10 0 * * *';
/** Hourly: today so far (admin overview freshness), the AI budget / spike alerts and the pending-approval nudge. */
export const STATS_TODAY_CRON = '20 * * * *';

export type StatsRollupMode = 'daily' | 'hourly';

/**
 * stats_daily rollup. 'daily' recomputes yesterday and today; 'hourly' recomputes today and checks the AI
 * alerts. Re-running is safe: each run overwrites the day's rows.
 */
export async function runStatsRollup(mode: StatsRollupMode, now = new Date()) {
  // Events still in this process's buffer belong in the numbers.
  await flushUsage();
  const today = utcDay(now);
  if (mode === 'daily') {
    const yesterday = await rollupDay(addDays(today, -1));
    logger.info(`[StatsRollup] ${addDays(today, -1)}: ${yesterday.length} rows`);
  }
  const rows = await rollupDay(today);
  logger.info(`[StatsRollup] ${today} (so far): ${rows.length} rows`);
  if (mode === 'hourly') {
    // The stats are already saved: an alert problem is logged, not a failed job.
    await runAiAlerts(today, rows, (chatId, text) =>
      bot.telegram.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } }),
    ).catch((error) => logger.error(`[StatsRollup] AI alerts failed: ${error}`));
    await remindOwnerOfPendingGroups((chatId, text) =>
      bot.telegram.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } }),
    ).catch((error) => logger.error(`[StatsRollup] Pending-group reminder failed: ${error}`));
  }
  return rows;
}

export async function processStatsRollupJob(job: Bull.Job) {
  const mode: StatsRollupMode = (job.data as { mode?: string } | undefined)?.mode === 'daily' ? 'daily' : 'hourly';
  try {
    await runStatsRollup(mode);
  } catch (error) {
    logger.error(`[StatsRollup] ${mode} run failed: ${error instanceof Error ? error.stack : error}`);
    throw error;
  }
}
