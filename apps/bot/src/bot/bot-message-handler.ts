import { aiCommand } from 'src/bot/commands/ai';
import { BotContext } from 'src/bot/interface/context';
import { recordMention } from 'src/bot/middlewares/usage.middleware';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import type { Message, MessageEntity } from 'telegraf/types';

/** Answer to a plain reply to the bot that isn't a question about a task card. HTML. */
export const PLAIN_REPLY_HINT = '💬 Start with /ai, e.g. <code>/ai task này làm gì?</code>';
/** The hint is shown at most once per user per day — after that, plain replies stay silent. */
export const PLAIN_REPLY_HINT_TTL_SECONDS = 24 * 60 * 60;
const HINT_KEY_PREFIX = 'ai_plain_reply_hint';

/** "task này làm gì?", "giải thích giúp", "sao lại thế", "what is this" — a question about the replied card. */
export const QUESTION_PATTERN = /\?\s*$|là gì|làm gì|giải thích|\bsao\b|explain|\bwhat\b/i;

type TextMessage = Message.TextMessage;

/**
 * Group messages that reach here passed mention-check: replies to the bot and "@bot …" messages
 * (commands have their own handlers). They are routed like this:
 * - "@TBot task này làm gì" → /ai with the text (minus the mention) as the request.
 * - a question replied to a task card ("task này làm gì?") → /ai about that card.
 * - any other plain reply to the bot → "start with /ai" hint, once per user per day; then silence.
 */
class BotMessageHandler {
  async process(ctx: BotContext): Promise<void> {
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
    const message = ctx.message as TextMessage | undefined;
    if (!message || typeof message.text !== 'string' || !message.text.trim()) return;
    if (message.from?.is_bot) return;

    const entities = message.entities ?? [];
    if (entities.some((e) => e.type === 'bot_command' && e.offset === 0)) return;

    try {
      if (this.mentionsBot(ctx, message.text, entities)) {
        recordMention(ctx, 'mention');
        await aiCommand.onAi(ctx, 'ai', { request: this.stripMention(ctx, message.text) });
        return;
      }

      const reply = replyTarget(message);
      if (!reply || !this.isFromBot(ctx, reply)) return;

      if (QUESTION_PATTERN.test(message.text)) {
        const card = await taskService.getTaskByCardMessage(chat.id, reply.message_id);
        if (card) {
          recordMention(ctx, 'card_question');
          await aiCommand.onAi(ctx, 'ai', { request: message.text.trim() });
          return;
        }
      }

      await this.hintOnce(ctx, message);
    } catch (error) {
      logger.error(`Error handling group message: ${error instanceof Error ? error.stack : error}`);
    }
  }

  private mentionsBot(ctx: BotContext, text: string, entities: MessageEntity[]): boolean {
    const username = ctx.botInfo?.username;
    if (username && text.toLowerCase().includes(`@${username.toLowerCase()}`)) return true;
    const botId = ctx.botInfo?.id;
    return entities.some((e) => e.type === 'text_mention' && !!botId && e.user?.id === botId);
  }

  private stripMention(ctx: BotContext, text: string): string {
    const username = ctx.botInfo?.username;
    if (!username) return text.trim();
    return text
      .replace(new RegExp(`@${username}\\b`, 'gi'), ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,:]+/, '')
      .trim();
  }

  private isFromBot(ctx: BotContext, reply: Message): boolean {
    const from = reply.from;
    if (!from) return false;
    if (ctx.botInfo?.id) return from.id === ctx.botInfo.id;
    return !!ctx.botInfo?.username && from.username === ctx.botInfo.username;
  }

  /** "💬 Start with /ai …" threaded to the reply, unless this user already got it today. */
  private async hintOnce(ctx: BotContext, message: TextMessage): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;
    let claimed = false;
    try {
      const result = await redisService.set(`${HINT_KEY_PREFIX}:${userId}`, '1', {
        NX: true,
        EX: PLAIN_REPLY_HINT_TTL_SECONDS,
      });
      claimed = result === 'OK';
    } catch (error) {
      // Can't tell whether they saw it: stay silent rather than risk repeating it.
      logger.warn(`Could not claim the plain-reply hint for ${userId}: ${error}`);
    }
    if (!claimed) return;
    await ctx.reply(PLAIN_REPLY_HINT, {
      parse_mode: 'HTML',
      reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    });
  }
}

/** The replied-to message, ignoring the implicit reply to a forum topic's first message. */
function replyTarget(message: TextMessage): Message | null {
  const reply = message.reply_to_message as Message | undefined;
  if (!reply || 'forum_topic_created' in reply) return null;
  return reply;
}

export const botMessageHandler = new BotMessageHandler();
