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

  const botInfo = await bot.telegram.getMe();
  configService.botUsername = botInfo.username;
  configService.botHasMainWebApp = Boolean((botInfo as { has_main_web_app?: boolean }).has_main_web_app);
  logger.info(`Bot @${botInfo.username} started (main mini app: ${configService.botHasMainWebApp})`);

  await setUpBotCommand.process();

  // Register job processors
  queueService.registerProcessor('due-reminder', processReminderJob);
  queueService.registerProcessor('daily-digest', processDigestJob);

  // Schedule recurring jobs. Clear old schedules first so a changed cron doesn't keep firing.
  // Both jobs run hourly and decide per group (in the group's timezone) whether to send.
  await queueService.removeAllRepeatingJobs();
  await queueService.addRepeatingJob('due-reminder', {}, '5 * * * *');
  await queueService.addRepeatingJob('daily-digest', {}, '0 * * * *');

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

