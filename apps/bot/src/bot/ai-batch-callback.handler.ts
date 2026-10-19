import {
  BATCH_CALLBACK_PREFIX,
  BATCH_UNDO_WINDOW_MS,
  BatchCallbackData,
} from 'src/shared/services/task-creation.service';
import { BotContext } from 'src/bot/interface/context';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { undoBatch } from 'src/shared/services/batch-undo.service';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { displayNameOf } from 'src/shared/services/message-buffer.service';
import { redisService } from 'src/shared/services/redis.service';
import { InlineKeyboardMarkup } from 'telegraf/types';

const EXPIRED_ALERT = '⏱ Undo is only available for 10 minutes. Delete tasks one by one on the board instead.';

async function loadBatch(key: string): Promise<BatchCallbackData | null> {
  // Read directly (not getCallbackData): an expired key must not overwrite the summary message.
  try {
    const raw = await redisService.get(`${BATCH_CALLBACK_PREFIX}:${key}`);
    return raw ? (JSON.parse(raw) as BatchCallbackData) : null;
  } catch (error) {
    logger.error(`Batch callback: could not load ${key}: ${error}`);
    return null;
  }
}

/** Removes the Undo button from the summary, keeping any other buttons (e.g. Open board). */
async function removeUndoButton(ctx: BotContext): Promise<void> {
  const message = ctx.callbackQuery?.message;
  const markup = message && 'reply_markup' in message ? (message.reply_markup as InlineKeyboardMarkup | undefined) : undefined;
  if (!markup) return;
  const rows = markup.inline_keyboard
    .map((row) => row.filter((b) => !('callback_data' in b && b.callback_data?.startsWith('batch:undo:'))))
    .filter((row) => row.length > 0);
  try {
    await ctx.editMessageReplyMarkup(rows.length ? { inline_keyboard: rows } : undefined);
  } catch (error) {
    logger.warn(`Batch callback: could not remove Undo button: ${error}`);
  }
}

async function isGroupAdmin(ctx: BotContext, chatId: number, telegramUserId: number): Promise<boolean> {
  try {
    const member = await ctx.telegram.getChatMember(chatId, telegramUserId);
    return member.status === 'creator' || member.status === 'administrator';
  } catch (error) {
    logger.warn(`Batch callback: getChatMember failed for ${telegramUserId}: ${error}`);
    return false;
  }
}

/** Handles `batch:<action>:<key>` callbacks (undo of an AI-created batch). */
export async function handleBatchCallback(ctx: BotContext): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query || !('data' in query)) return;
  const [, action, key] = query.data.split(':');

  try {
    if (action === 'noop') {
      await ctx.answerCbQuery();
      return;
    }
    if (action !== 'undo' || !key) {
      await ctx.answerCbQuery('This button is no longer active.');
      return;
    }

    const batch = await loadBatch(key);
    if (!batch || Date.now() - batch.createdAt > BATCH_UNDO_WINDOW_MS) {
      await ctx.answerCbQuery(EXPIRED_ALERT, { show_alert: true });
      await removeUndoButton(ctx);
      return;
    }

    const fromId = query.from.id;
    const allowed = fromId === batch.requesterTelegramId || (await isGroupAdmin(ctx, batch.chatId, fromId));
    if (!allowed) {
      await ctx.answerCbQuery(`Only ${batch.requesterName} or a group admin can undo this.`, { show_alert: true });
      return;
    }

    // Guard against double taps deleting twice / editing twice.
    const lock = await redisService.set(`batch_undo_lock:${key}`, '1', { NX: true, EX: 60 });
    if (lock === null) {
      await ctx.answerCbQuery('Already undoing…');
      return;
    }

    const actor = await userService.findUserByTelegramId(fromId);
    const { removed } = await undoBatch({
      batchId: batch.batchId,
      groupId: batch.groupId,
      actor: actor?._id ?? null,
      via: 'bot',
    });
    await callbackDataStorageService.delCallbackData(key, BATCH_CALLBACK_PREFIX);

    const name = displayNameOf(query.from);
    await ctx.editMessageText(`↩️ Undone by ${name} · ${removed} task${removed === 1 ? '' : 's'} removed`);
    await ctx.answerCbQuery('Undone');
  } catch (error) {
    logger.error(`Batch callback error: ${error}`);
    await ctx.answerCbQuery('Something went wrong. Please try again.').catch(() => undefined);
  }
}
