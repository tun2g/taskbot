import { randomBytes } from 'crypto';
import { BotContext } from 'src/bot/interface/context';
import { groupService } from 'src/database/services/group.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { BufferedMessage, messageText, toBufferedMessage } from 'src/shared/services/message-buffer.service';
import { redisService } from 'src/shared/services/redis.service';
import type { InlineKeyboardButton, Message } from 'telegraf/types';

/**
 * Replying to a message with a list command (/list, /mytasks, legacy /tasks) most likely
 * means "make tasks from this" — so the reply offers a one-tap "create tasks from that
 * message" button.
 */

export const CREATE_FROM_REPLY_PREFIX = 'mktask:';
const STORE_PREFIX = 'mktask_cb';
const TTL_SECONDS = 60 * 60;

interface StoredReply {
  message: BufferedMessage;
}

function storeKey(key: string): string {
  return `${STORE_PREFIX}:${key}`;
}

/** The message a command replies to, if it can become a task (has text, isn't a topic header or the bot's own). */
function replyTarget(ctx: BotContext): Message | null {
  const message = ctx.message;
  if (!message || !('reply_to_message' in message) || !message.reply_to_message) return null;
  const reply = message.reply_to_message as Message;
  if ('forum_topic_created' in reply) return null;
  if (reply.from?.id === ctx.botInfo?.id) return null;
  return messageText(reply as never) ? reply : null;
}

/** A button to create tasks from the replied message, or null when the command isn't a reply. */
export async function createFromReplyButton(ctx: BotContext): Promise<InlineKeyboardButton | null> {
  const reply = replyTarget(ctx);
  if (!reply || !ctx.chat) return null;
  try {
    const key = randomBytes(6).toString('hex');
    const data: StoredReply = { message: toBufferedMessage(reply as never, ctx.chat.id) };
    await redisService.set(storeKey(key), JSON.stringify(data), { EX: TTL_SECONDS });
    return { text: '📝 Create tasks from that message', callback_data: `${CREATE_FROM_REPLY_PREFIX}go:${key}` };
  } catch (error) {
    logger.warn(`Could not offer create-from-reply button: ${error}`);
    return null;
  }
}

/** Keeps the message's other buttons (e.g. "Open board"), drops ours. */
async function removeOurButton(ctx: BotContext): Promise<void> {
  const markup = (ctx.callbackQuery?.message as { reply_markup?: { inline_keyboard: InlineKeyboardButton[][] } })
    ?.reply_markup;
  const rows = (markup?.inline_keyboard ?? [])
    .map((row) =>
      row.filter((b) => !('callback_data' in b && b.callback_data?.startsWith(CREATE_FROM_REPLY_PREFIX))),
    )
    .filter((row) => row.length > 0);
  await ctx.editMessageReplyMarkup(rows.length ? { inline_keyboard: rows } : undefined).catch(() => undefined);
}

export async function handleCreateFromReplyCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
  const key = data.slice(`${CREATE_FROM_REPLY_PREFIX}go:`.length);

  try {
    // Single use: whoever taps first creates the tasks; the button then disappears
    const raw = key ? await redisService.get(storeKey(key)) : null;
    if (!raw) {
      await removeOurButton(ctx);
      await ctx.answerCbQuery('This button has expired — reply to the message with /new instead.', {
        show_alert: true,
      });
      return;
    }
    await redisService.del(storeKey(key));
    const stored = JSON.parse(raw) as StoredReply;

    const user = await userService.findOrCreateUser(ctx);
    const chat = ctx.chat;
    const group = chat && 'title' in chat ? await groupService.findOrCreateGroup(chat.id, chat.title) : null;
    if (!user || !group) {
      await ctx.answerCbQuery("Couldn't create tasks right now. Please try /new again.", { show_alert: true });
      return;
    }

    await ctx.answerCbQuery('📝 Creating tasks…');
    await removeOurButton(ctx);
    // Loaded on demand: task-creation imports the bot, which imports /tasks → this file
    const { createTasksFromInput } = await import('src/shared/services/task-creation.service');
    await createTasksFromInput(ctx, { messages: [stored.message], requester: user, group });
  } catch (error) {
    logger.error(`Create-from-reply failed: ${error instanceof Error ? error.stack : error}`);
    await ctx
      .answerCbQuery('Something went wrong. Please reply to the message with /new.', { show_alert: true })
      .catch(() => undefined);
  }
}
