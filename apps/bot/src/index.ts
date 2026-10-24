import 'dotenv/config';

import { bot } from 'src/bot';
import { setUpBotCommand } from 'src/bot/commands/setup';
import { configService } from 'src/configs/configuration';
import { mongodbConnection } from 'src/database/connection';
import { runMigrations } from 'src/database/migrations';
import { processReminderJob } from 'src/jobs/reminder.job';
import { processDigestJob } from 'src/jobs/digest.job';
import { app } from 'src/server';
import logger from 'src/shared/logger/logger';
import { queueService } from 'src/shared/services/queue.service';
import { processStatsRollupJob, STATS_ROLLUP_CRON, STATS_TODAY_CRON } from 'src/jobs/stats-rollup.job';
import { flushUsage } from 'src/shared/services/telemetry/usage-tracker';
import { publishRuntimeInfo } from 'src/shared/services/settings.service';

const STARTED_AT = new Date();

// `chat_member` is not delivered unless requested explicitly (and the bot must be a group admin).
const ALLOWED_UPDATES: ('message' | 'edited_message' | 'callback_query' | 'chat_member' | 'my_chat_member')[] = [
  'message',
  'edited_message',
  'callback_query',
  'chat_member',
  'my_chat_member',
];

async function bootstrap() {
  await mongodbConnection.ensureConnection();
  await runMigrations();
  // The admin app shows the model, the AI_DAILY_LIMIT fallback and "Bot started X ago" from this.
  await publishRuntimeInfo(STARTED_AT);

  const botInfo = await bot.telegram.getMe();
  configService.botUsername = botInfo.username;
  configService.botHasMainWebApp = Boolean((botInfo as { has_main_web_app?: boolean }).has_main_web_app);
  logger.info(`Bot @${botInfo.username} started (main mini app: ${configService.botHasMainWebApp})`);
  if (configService.botOwnerTelegramId === null) {
    logger.warn(
      'BOT_OWNER_TELEGRAM_ID is not set: new groups are approved automatically. Set it to your Telegram user id to approve groups yourself.',
    );
  }

  await setUpBotCommand.process();

  // Register job processors
  queueService.registerProcessor('due-reminder', processReminderJob);
  queueService.registerProcessor('daily-digest', processDigestJob);
  queueService.registerProcessor('stats-rollup', processStatsRollupJob);

  // Schedule recurring jobs. Clear old schedules first so a changed cron doesn't keep firing.
  // Both jobs run hourly and decide per group (in the group's timezone) whether to send.
  await queueService.removeAllRepeatingJobs();
  await queueService.addRepeatingJob('due-reminder', {}, '5 * * * *');
  await queueService.addRepeatingJob('daily-digest', {}, '0 * * * *');
  // Admin stats: yesterday (final) + today at 00:10 UTC; today again every hour (+ AI budget alerts).
  await queueService.addRepeatingJob('stats-rollup', { mode: 'daily' }, STATS_ROLLUP_CRON);
  await queueService.addRepeatingJob('stats-rollup', { mode: 'hourly' }, STATS_TODAY_CRON);

  const port = process.env.PORT || 3000;

  if (process.env.WEBHOOK_URL) {
    const webhookUrl = `${process.env.WEBHOOK_URL}/api/bot/webhook`;
    await bot.telegram.setWebhook(webhookUrl, { allowed_updates: ALLOWED_UPDATES });
    app.use(bot.webhookCallback('/api/bot/webhook'));
    logger.info(`Webhook set to ${webhookUrl}`);
  } else {
    bot.launch({ allowedUpdates: ALLOWED_UPDATES });
    logger.info('Bot started in polling mode');
  }

  app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });
}

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
  bot.stop(signal);
  await flushUsage();
  await queueService.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => logger.error(`Uncaught Exception: ${err}`));
process.on('unhandledRejection', (err) => logger.error(`Unhandled Rejection: ${err}`));

bootstrap().catch((err) => {
  logger.error(`Bootstrap failed: ${err}`);
  process.exit(1);
});

