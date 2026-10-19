import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import { Message, MessageEntity } from 'telegraf/types';

export interface BufferedMention {
  /** The mention as written in the message, e.g. "@an" or "An Nguyen". */
  text: string;
  /** Set for text_mention entities (users without a username). */
  telegramUserId?: number;
}

export interface BufferedMessage {
  messageId: number;
  chatId: number;
  text: string;
  fromUserId: number;
  /** "@username" when available, else the first name. */
  fromName: string;
  /** Unix seconds (Telegram `message.date`). */
  date: number;
  mentions?: BufferedMention[];
  /** Forum topic of the message (undefined = General or a group without Topics). */
  threadId?: number;
}

export const BUFFER_MAX_MESSAGES = 200;
export const BUFFER_TTL_SECONDS = 48 * 60 * 60;

type AnyMessage = Partial<Message.TextMessage & Message.CaptionableMessage> & {
  message_id: number;
  date?: number;
  from?: Message['from'];
  message_thread_id?: number;
  is_topic_message?: boolean;
};

export function messageText(message: AnyMessage | undefined | null): string {
  if (!message) return '';
  return (message.text ?? message.caption ?? '').trim();
}

function messageEntities(message: AnyMessage): MessageEntity[] {
  return message.entities ?? message.caption_entities ?? [];
}

export function isCommandMessage(message: AnyMessage): boolean {
  const text = message.text ?? message.caption ?? '';
  return messageEntities(message).some((e) => e.type === 'bot_command' && e.offset === 0) || text.startsWith('/');
}

export function displayNameOf(from: { username?: string; first_name?: string } | undefined | null): string {
  if (!from) return 'Someone';
  return from.username ? `@${from.username}` : from.first_name || 'Someone';
}

export function extractMentions(message: AnyMessage): BufferedMention[] {
  const raw = message.text ?? message.caption ?? '';
  const mentions: BufferedMention[] = [];
  for (const entity of messageEntities(message)) {
    const text = raw.substring(entity.offset, entity.offset + entity.length);
    if (entity.type === 'text_mention' && entity.user) {
      mentions.push({ text, telegramUserId: entity.user.id });
    } else if (entity.type === 'mention') {
      mentions.push({ text });
    }
  }
  return mentions;
}

/** Converts a Telegram message into the buffered shape (text or caption). */
export function toBufferedMessage(message: AnyMessage, chatId: number, textOverride?: string): BufferedMessage {
  const mentions = extractMentions(message);
  const threadId = message.is_topic_message ? message.message_thread_id : undefined;
  return {
    messageId: message.message_id,
    chatId,
    text: textOverride ?? messageText(message),
    fromUserId: message.from?.id ?? 0,
    fromName: displayNameOf(message.from),
    date: message.date ?? Math.floor(Date.now() / 1000),
    ...(mentions.length ? { mentions } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

/** Restricts buffered messages to one forum topic; `threadId: undefined` = General. */
export interface TopicScope {
  threadId?: number;
}

function inTopic(messages: BufferedMessage[], topic?: TopicScope): BufferedMessage[] {
  if (!topic) return messages;
  return messages.filter((m) => (m.threadId ?? undefined) === topic.threadId);
}

export class MessageBufferService {
  private key(chatId: number) {
    return `msgbuf:${chatId}`;
  }

  async push(message: BufferedMessage): Promise<void> {
    const key = this.key(message.chatId);
    await redisService.lPush(key, JSON.stringify(message));
    await redisService.lTrim(key, 0, BUFFER_MAX_MESSAGES - 1);
    await redisService.expire(key, BUFFER_TTL_SECONDS);
  }

  /** All buffered messages for the chat, oldest first. Never throws. */
  async getAll(chatId: number): Promise<BufferedMessage[]> {
    try {
      const raw = await redisService.lRange(this.key(chatId), 0, BUFFER_MAX_MESSAGES - 1);
      const parsed: BufferedMessage[] = [];
      for (const item of raw) {
        try {
          parsed.push(JSON.parse(item) as BufferedMessage);
        } catch {
          // skip corrupt entries
        }
      }
      // LPUSH stores newest first; sort by id so edits/out-of-order pushes stay chronological.
      const seen = new Set<number>();
      return parsed
        .sort((a, b) => a.messageId - b.messageId)
        .filter((m) => (seen.has(m.messageId) ? false : (seen.add(m.messageId), true)));
    } catch (error) {
      logger.error(`Error reading message buffer for chat ${chatId}: ${error}`);
      return [];
    }
  }

  /** The last `limit` messages, oldest first. With `topic`, only that forum topic's messages. */
  async getRecent(chatId: number, limit: number, topic?: TopicScope): Promise<BufferedMessage[]> {
    const all = inTopic(await this.getAll(chatId), topic);
    return all.slice(-limit);
  }

  /** Messages with an id strictly greater than `messageId`, oldest first. With `topic`, only that topic's. */
  async getAfter(chatId: number, messageId: number, topic?: TopicScope): Promise<BufferedMessage[]> {
    const all = inTopic(await this.getAll(chatId), topic);
    return all.filter((m) => m.messageId > messageId);
  }
}

export const messageBufferService = new MessageBufferService();
