import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';

/** Where the "(via app)" group post of a web-created batch is remembered (for undo). */
const APP_BATCH_POST_PREFIX = 'app_batch_post';
const APP_BATCH_POST_TTL_SECONDS = 15 * 60;

/** Remembers the group post of an app/MCP-created batch so an undo can mark it "↩️ Undone". Never throws. */
export async function rememberAppBatchPost(batchId: string, post: { chatId: number; messageId: number }): Promise<void> {
  await Promise.resolve(
    redisService.set(`${APP_BATCH_POST_PREFIX}:${batchId}`, JSON.stringify(post), { EX: APP_BATCH_POST_TTL_SECONDS }),
  ).catch((error: unknown) => logger.warn(`Could not remember batch post ${batchId}: ${error}`));
}

/** The group post of a web-created batch, if it was remembered. */
export async function getAppBatchPost(batchId: string): Promise<{ chatId: number; messageId: number } | null> {
  try {
    const raw = await redisService.get(`${APP_BATCH_POST_PREFIX}:${batchId}`);
    return raw ? (JSON.parse(raw) as { chatId: number; messageId: number }) : null;
  } catch (error) {
    logger.warn(`Could not load batch post ${batchId}: ${error}`);
    return null;
  }
}

export async function forgetAppBatchPost(batchId: string) {
  await Promise.resolve(redisService.del(`${APP_BATCH_POST_PREFIX}:${batchId}`)).catch(() => undefined);
}
