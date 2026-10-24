import mongoose from 'mongoose';
import { createApp } from 'src/app';
import { config, validateConfig } from 'src/config/configuration';
import logger from 'src/shared/logger';
import { getKv } from 'src/shared/redis';

async function connectMongo(retries = 5, delayMs = 5000) {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(config.mongoUri);
      logger.info('Connected to MongoDB');
      return;
    } catch (err) {
      logger.error(`MongoDB connection attempt ${attempt}/${retries} failed: ${err}`);
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  const problems = validateConfig();
  if (problems.length) {
    for (const p of problems) logger.error(`Config: ${p}`);
    logger.error('The admin API refuses to start until these are fixed (see apps/admin-api/.env.example).');
    process.exit(1);
  }
  // The bot owns indexes and migrations; the admin API only reads/writes documents.
  mongoose.set('autoIndex', false);
  await connectMongo();
  getKv();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`Admin API listening on :${config.port} (owner ${config.ownerTelegramId}, public URL ${config.publicUrl})`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      mongoose.connection.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(`Admin API failed to start: ${err}`);
  process.exit(1);
});
