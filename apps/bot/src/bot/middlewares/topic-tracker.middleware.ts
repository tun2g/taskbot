import { BotContext } from 'src/bot/interface/context';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { redisService } from 'src/shared/services/redis.service';

const CACHE_SECONDS = 6 * 60 * 60;

/**
 * Remembers whether a supergroup has Topics and the names of topics seen, so events can
 * go to the "task events" topic (the Bot API has no way to list topics). Cheap: hits
 * the database only when the forum flag or a topic name is new.
 */
export const topicTrackerMiddleware = async (ctx: BotContext, next: () => Promise<void>) => {
  try {
    const chat = ctx.chat;
    const message = (ctx.message ?? ctx.editedMessage) as Record<string, unknown> | undefined;
    if (chat?.type === 'supergroup' && message) {
      const isForum = Boolean((chat as { is_forum?: boolean }).is_forum);
      const threadId = message.message_thread_id as number | undefined;
      const topicName =
        (message.forum_topic_created as { name?: string } | undefined)?.name ??
        (message.forum_topic_edited as { name?: string } | undefined)?.name ??
        (message.reply_to_message as { forum_topic_created?: { name?: string } } | undefined)?.forum_topic_created?.name;

      const forumKey = `forum:${chat.id}`;
      const topicKey = threadId && topicName ? `topic:${chat.id}:${threadId}` : null;
      const [cachedForum, cachedTopic] = await Promise.all([
        redisService.get(forumKey).catch(() => null),
        topicKey ? redisService.get(topicKey).catch(() => null) : Promise.resolve(null),
      ]);

      const forumChanged = cachedForum !== (isForum ? '1' : '0');
      const topicChanged = topicKey !== null && cachedTopic !== topicName;
      if (forumChanged || topicChanged) {
        const group = await groupService.findOrCreateGroup(chat.id, chat.title);
        if (group) await groupMessengerService.trackMessage(group, message, isForum);
        await redisService.set(forumKey, isForum ? '1' : '0', { EX: CACHE_SECONDS }).catch(() => undefined);
        if (topicKey && topicName) {
          await redisService.set(topicKey, topicName, { EX: CACHE_SECONDS }).catch(() => undefined);
        }
      }
    }
  } catch (error) {
    logger.warn(`Topic tracking failed: ${error}`);
  }
  return next();
};
