import { BotContext } from 'src/bot/interface/context';
import logger from 'src/shared/logger/logger';
import {
  isCommandMessage,
  messageBufferService,
  messageText,
  toBufferedMessage,
} from 'src/shared/services/message-buffer.service';

/**
 * Records recent group messages (text or caption; not commands, not bots) so
 * `/task N` and `/task all` can turn several messages into tasks.
 * Only sees all messages when privacy mode is OFF in BotFather. Never throws.
 */
export const messageBufferMiddleware = async (ctx: BotContext, next: () => Promise<void>) => {
  try {
    const chat = ctx.chat;
    const message = ctx.message;
    if (chat && message && (chat.type === 'group' || chat.type === 'supergroup') && !message.from?.is_bot) {
      if (messageText(message) && !isCommandMessage(message)) {
        await messageBufferService.push(toBufferedMessage(message, chat.id));
      }
    }
  } catch (error) {
    logger.warn(`Message buffer: failed to record message: ${error}`);
  }
  return next();
};
