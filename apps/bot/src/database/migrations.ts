import { DEFAULT_TASK_TYPE } from '@tbot/shared';
import { Task } from 'src/database/models/task.model';
import logger from 'src/shared/logger/logger';

/**
 * Idempotent data fixes run on startup. Each step only touches documents that
 * still need it, so re-running is cheap and safe.
 */
export async function runMigrations(): Promise<void> {
  try {
    // Tasks created before task types existed have no `type`, so type filters skip them
    const typed = await Task.updateMany({ type: { $exists: false } }, { $set: { type: DEFAULT_TASK_TYPE } });
    if (typed.modifiedCount > 0) {
      logger.info(`[Migrations] Set default type on ${typed.modifiedCount} tasks`);
    }

    // Single source message → list, so every reader can rely on `sourceMessages`
    const legacySource = await Task.find(
      { sourceMessage: { $ne: null }, $or: [{ sourceMessages: { $exists: false } }, { sourceMessages: { $size: 0 } }] },
      { sourceMessage: 1 },
    );
    for (const task of legacySource) {
      await Task.updateOne({ _id: task._id }, { $set: { sourceMessages: [task.sourceMessage] } });
    }
    if (legacySource.length > 0) {
      logger.info(`[Migrations] Copied legacy sourceMessage on ${legacySource.length} tasks`);
    }
  } catch (error) {
    // Never block startup on a data fix — log and continue
    logger.error(`[Migrations] Failed: ${error}`);
  }
}
