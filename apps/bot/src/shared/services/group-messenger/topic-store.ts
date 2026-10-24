import { IGroup, Group } from 'src/database/models/group.model';
import logger from 'src/shared/logger/logger';
import { Telegram } from 'telegraf';
import { errorText, EVENTS_TOPIC_ICON_COLOR, EVENTS_TOPIC_NAME, SETUP_HINT_INTERVAL_MS } from './topics';

/** Records forum state and topic names seen in an incoming message. Never throws. */
export async function trackTopicInfo(group: IGroup, message: Record<string, unknown>, isForum: boolean): Promise<void> {
  try {
    const updates: Record<string, unknown> = {};
    if (isForum !== Boolean(group.isForum)) updates.isForum = isForum;

    const threadId = message.message_thread_id as number | undefined;
    const created = message.forum_topic_created as { name?: string } | undefined;
    const edited = message.forum_topic_edited as { name?: string } | undefined;
    const replyCreated = (message.reply_to_message as { forum_topic_created?: { name?: string } } | undefined)
      ?.forum_topic_created;
    const name = created?.name ?? edited?.name ?? replyCreated?.name;
    const knownTopics = group.knownTopics ?? [];

    if (threadId && name) {
      const known = knownTopics.find((t) => t.id === threadId);
      if (!known || known.name !== name) {
        updates.knownTopics = [...knownTopics.filter((t) => t.id !== threadId), { id: threadId, name }];
      }
    }

    if (Object.keys(updates).length > 0) {
      await Group.updateOne({ _id: group._id }, { $set: updates });
      Object.assign(group, updates);
    }
  } catch (error) {
    logger.warn(`[GroupMessenger] Could not track topic info for group ${group.telegramGroupId}: ${error}`);
  }
}

/** The events topic was deleted: forget it (and its name, so it isn't picked again). */
export async function forgetEventsTopic(group: IGroup, threadId: number): Promise<void> {
  logger.warn(`[GroupMessenger] Events topic ${threadId} of group ${group.telegramGroupId} is gone; forgetting it`);
  try {
    await Group.updateOne(
      { _id: group._id },
      { $set: { eventsTopicId: null }, $pull: { knownTopics: { id: threadId } } },
    );
  } catch (error) {
    logger.warn(`[GroupMessenger] Could not reset events topic: ${errorText(error)}`);
  }
  group.eventsTopicId = null;
  group.knownTopics = (group.knownTopics ?? []).filter((t) => t.id !== threadId);
}

/**
 * Creates the "Task events" topic and saves it on the group. Null when Telegram refuses; the time is
 * recorded in `createFailedAt` so the caller can back off.
 */
export async function createEventsTopic(
  telegram: Telegram,
  group: IGroup,
  createFailedAt: Map<string, number>,
): Promise<number | null> {
  const key = String(group._id);
  let topic;
  try {
    topic = await telegram.createForumTopic(group.telegramGroupId, EVENTS_TOPIC_NAME, {
      icon_color: EVENTS_TOPIC_ICON_COLOR,
    });
  } catch (error) {
    // Usually: the bot isn't an admin with "Manage topics"
    createFailedAt.set(key, Date.now());
    logger.info(`[GroupMessenger] Could not create events topic in ${group.telegramGroupId}: ${errorText(error)}`);
    return null;
  }

  createFailedAt.delete(key);
  const entry = { id: topic.message_thread_id, name: topic.name };
  group.eventsTopicId = topic.message_thread_id;
  group.knownTopics = [...(group.knownTopics ?? []).filter((t) => t.id !== entry.id), entry];
  try {
    await Group.updateOne(
      { _id: group._id },
      { $set: { eventsTopicId: topic.message_thread_id, knownTopics: group.knownTopics } },
    );
  } catch (error) {
    logger.warn(`[GroupMessenger] Created events topic but could not save it: ${errorText(error)}`);
  }
  logger.info(`[GroupMessenger] Created "${EVENTS_TOPIC_NAME}" topic in group ${group.telegramGroupId}`);
  return topic.message_thread_id;
}

/** True at most once per 7 days per group: time to show the "set up the events topic" tip. */
export async function claimSetupHint(group: IGroup): Promise<boolean> {
  const now = Date.now();
  const last = group.topicSetupHintAt ? new Date(group.topicSetupHintAt).getTime() : 0;
  if (now - last < SETUP_HINT_INTERVAL_MS) return false;
  try {
    const cutoff = new Date(now - SETUP_HINT_INTERVAL_MS);
    const result = await Group.updateOne(
      { _id: group._id, $or: [{ topicSetupHintAt: null }, { topicSetupHintAt: { $lt: cutoff } }] },
      { $set: { topicSetupHintAt: new Date(now) } },
    );
    group.topicSetupHintAt = new Date(now);
    return result.modifiedCount === 1;
  } catch (error) {
    logger.warn(`[GroupMessenger] Could not record setup hint: ${errorText(error)}`);
    return false;
  }
}
