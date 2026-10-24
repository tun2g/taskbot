import logger from 'src/shared/logger/logger';
import { Telegram } from 'telegraf';
import { errorText, isTopicClosed, SendExtra } from './topics';

/** Where a group-wide notice can go: the main chat, or the events topic as a fallback. */
export interface NoticeTarget {
  telegramGroupId: number;
  isForum?: boolean;
  eventsTopicId?: number | null;
}

/**
 * Posts a group-wide notice (approved / paused / back / waiting for approval) where everyone sees it: the main
 * chat — General in a forum. The "Task events" topic is a feed of task updates people may mute, so it is only the
 * fallback when General is closed to the bot. Throws like sendMessage when both fail.
 */
export async function sendGroupNotice(telegram: Telegram, group: NoticeTarget, text: string, extra: SendExtra = {}) {
  try {
    return await telegram.sendMessage(group.telegramGroupId, text, extra);
  } catch (error) {
    if (!group.isForum || !group.eventsTopicId || !isTopicClosed(errorText(error))) throw error;
    logger.warn(`[GroupMessenger] General is closed in ${group.telegramGroupId}; posting the notice in the events topic`);
    return telegram.sendMessage(group.telegramGroupId, text, { ...extra, message_thread_id: group.eventsTopicId });
  }
}
