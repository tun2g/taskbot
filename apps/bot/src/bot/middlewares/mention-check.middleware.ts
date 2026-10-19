import { BotContext } from 'src/bot/interface/context';
import logger from 'src/shared/logger/logger';

/**
 * In groups, only let through updates that are meant for this bot: commands
 * (`/task` or `/task@ThisBot` — Telegraf's command router drops `/task@OtherBot`),
 * replies to the bot, and messages that @mention it. Plain chatter stops here;
 * it has already been recorded by the membership and message-buffer middlewares.
 */
export const mentionCheckMiddleware = async (ctx: BotContext, next: () => Promise<void>) => {
  const chatType = ctx.chat?.type;

  if (chatType === 'private') {
    return next();
  }

  if (ctx.callbackQuery) {
    return next();
  }

  if (chatType === 'group' || chatType === 'supergroup' || chatType === 'channel') {
    const botUsername = ctx.botInfo?.username;

    if (!botUsername) {
      logger.warn('Bot username not available');
      return next();
    }

    if (!ctx.message || !('text' in ctx.message)) {
      return;
    }

    const messageText = ctx.message.text || '';
    const entities = ctx.message.entities || [];

    const isCommand = entities.some((entity) => entity.type === 'bot_command' && entity.offset === 0);
    if (isCommand) {
      return next();
    }

    if ('reply_to_message' in ctx.message && ctx.message.reply_to_message) {
      if (ctx.message.reply_to_message.from?.username === botUsername) {
        return next();
      }
    }

    const mentionPattern = `@${botUsername}`;

    if (messageText.toLowerCase().includes(mentionPattern.toLowerCase())) {
      logger.info(`Bot mentioned in ${chatType} by user ${ctx.from?.id}`);
      return next();
    }

    const isMentioned = entities.some((entity) => {
      if (entity.type === 'text_mention') {
        return entity.user?.username === botUsername;
      }
      return false;
    });

    if (isMentioned) {
      logger.info(`Bot mentioned (via entity) in ${chatType} by user ${ctx.from?.id}`);
      return next();
    }

    logger.debug(`Bot not mentioned in ${chatType}, ignoring message from user ${ctx.from?.id}`);
    return;
  }

  return next();
};
