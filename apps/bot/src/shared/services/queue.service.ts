import Bull, { Queue } from 'bull';
import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';

class QueueService {
  private queue: Queue;

  constructor() {
    this.queue = new Bull('task-management', {
      redis: {
        host: configService.database.redis.host,
        port: configService.database.redis.port,
        db: parseInt(configService.database.redis.database),
      },
    });

    this.queue.on('error', (error) => {
      logger.error(`Queue error: ${error}`);
    });

    this.queue.on('failed', (job, err) => {
      logger.error(`Job ${job.id} failed: ${err.message}`);
    });

    this.queue.on('completed', (job) => {
      logger.info(`Job ${job.id} completed`);
    });
  }

  registerProcessor(name: string, processor: (job: Bull.Job) => Promise<void>) {
    this.queue.process(name, processor);
    logger.info(`Registered processor: ${name}`);
  }

  async addRepeatingJob(name: string, data: unknown, cronExpression: string, timezone = 'UTC') {
    try {
      await this.queue.add(name, data, {
        repeat: {
          cron: cronExpression,
          tz: timezone,
        },
        // Keep recent history (bounded): the admin System page reads it for "last run" / "last error".
        removeOnComplete: 200,
        removeOnFail: 200,
      });
      logger.info(`Added repeating job: ${name} with cron: ${cronExpression}`);
    } catch (error) {
      logger.error(`Error adding repeating job ${name}: ${error}`);
    }
  }

  async addJob(name: string, data: unknown, options?: Bull.JobOptions) {
    try {
      await this.queue.add(name, data, options);
      logger.info(`Added job: ${name}`);
    } catch (error) {
      logger.error(`Error adding job ${name}: ${error}`);
    }
  }

  async removeAllRepeatingJobs() {
    try {
      const repeatableJobs = await this.queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await this.queue.removeRepeatableByKey(job.key);
      }
      logger.info('Removed all repeating jobs');
    } catch (error) {
      logger.error(`Error removing repeating jobs: ${error}`);
    }
  }

  getQueue(): Queue {
    return this.queue;
  }

  async close() {
    await this.queue.close();
  }
}

export const queueService = new QueueService();
