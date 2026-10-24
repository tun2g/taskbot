import { IGroup } from 'src/database/models/group.model';
import logger from 'src/shared/logger/logger';
import { Telegram } from 'telegraf';
import { Message } from 'telegraf/types';
import {
  buildMessageLink,
  errorText,
  isTopicClosed,
  isTopicGone,
  SendEventOptions,
  SendExtra,
  sourceLinkLine,
} from './topics';

/** sendMessage; a formatting mistake never costs the message (retried as plain text). */
export async function postMessage(
  telegram: Telegram,
  chatId: number,
  text: string,
  extra: SendExtra,
): Promise<Message.TextMessage> {
  try {
    return await telegram.sendMessage(chatId, text, extra);
  } catch (error) {
    if (extra.parse_mode && errorText(error).includes("can't parse entities")) {
      logger.warn(`[GroupMessenger] Formatting rejected, resending as plain text: ${errorText(error)}`);
      const { parse_mode: _ignored, ...plain } = extra;
      return telegram.sendMessage(chatId, text, plain);
    }
    throw error;
  }
}

/**
 * Sends one event into `threadId` (undefined = General), replying to `options.source` — across topics
 * when Telegram allows it, else with an "Original message" link.
 */
export async function deliverEvent(
  telegram: Telegram,
  group: IGroup,
  text: string,
  threadId: number | undefined,
  options: SendEventOptions,
): Promise<Message.TextMessage> {
  const chatId = group.telegramGroupId;
  const extra: SendExtra = { ...options.extra };
  delete extra.message_thread_id;
  if (threadId) extra.message_thread_id = threadId;

  const source = options.source;
  if (!source) return postMessage(telegram, chatId, text, extra);

  // Same topic: a normal reply that still goes out if the source was deleted.
  if (source.threadId === threadId) {
    return postMessage(telegram, chatId, text, {
      ...extra,
      reply_parameters: { message_id: source.messageId, allow_sending_without_reply: true },
    });
  }

  // Cross-topic reply (Bot API 7.0+). allow_sending_without_reply only works within one topic.
  try {
    const sent = await postMessage(telegram, chatId, text, { ...extra, reply_parameters: { message_id: source.messageId } });
    if (threadId && sent?.message_thread_id !== undefined && sent.message_thread_id !== threadId) {
      // Telegram put the reply in the source's topic instead of ours: move it.
      await telegram.deleteMessage(chatId, sent.message_id).catch(() => undefined);
      throw new Error(`reply landed in topic ${sent.message_thread_id}`);
    }
    return sent;
  } catch (error) {
    const message = errorText(error);
    if (isTopicGone(message) || isTopicClosed(message)) throw error;
    logger.info(`[GroupMessenger] Cross-topic reply failed (${message}); sending with a link instead`);
    const link = source.linkFallback === false ? null : buildMessageLink(chatId, source.messageId, source.threadId);
    return postMessage(telegram, chatId, link ? text + sourceLinkLine(link, extra.parse_mode) : text, extra);
  }
}
