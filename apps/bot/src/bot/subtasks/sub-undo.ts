import { randomBytes } from 'crypto';
import { displayName } from 'src/bot/task-card.renderer';
import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import { BATCH_CALLBACK_PREFIX, BatchCallbackData } from 'src/shared/services/batch-undo.constants';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { InlineKeyboardButton } from 'telegraf/types';

// /sub batches get the same "↩️ Undo" (10 minutes) as /task and /ai — handled by ai-batch-callback.handler.

/** Stores the batch for its Undo button; the button key, or undefined when Redis is unavailable. */
export async function rememberSubBatch(
  group: IGroup,
  requester: IUser,
  batchId: string,
  count: number,
): Promise<string | undefined> {
  const key = randomBytes(6).toString('hex');
  const data: BatchCallbackData = {
    batchId,
    groupId: String(group._id),
    chatId: group.telegramGroupId,
    requesterTelegramId: requester.telegramUserId,
    requesterName: displayName(requester),
    count,
    createdAt: Date.now(),
  };
  try {
    await callbackDataStorageService.setCallbackData(key, BATCH_CALLBACK_PREFIX, data);
    return key;
  } catch (error) {
    logger.warn(`Could not store undo for /sub batch ${batchId}: ${error}`);
    return undefined;
  }
}

/** [↩️ Undo] [📱 Open #42] on one row (either may be missing). */
export function subBatchButtons(undoKey: string | undefined, open: InlineKeyboardButton | null): InlineKeyboardButton[][] {
  const row: InlineKeyboardButton[] = [];
  if (undoKey) row.push({ text: '↩️ Undo', callback_data: `batch:undo:${undoKey}` });
  if (open) row.push(open);
  return row.length ? [row] : [];
}
