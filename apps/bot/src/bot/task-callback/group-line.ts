import { BotContext } from 'src/bot/interface/context';
import { escapeMarkdown, truncate } from 'src/bot/task-card.renderer';
import { Group, IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import logger from 'src/shared/logger/logger';
import { groupMessengerService, isForumChat, topicOf } from 'src/shared/services/group-messenger.service';
import { taskButton } from 'src/shared/utils/app-links';
import { Telegram } from 'telegraf';

/**
 * Short group line (an event), threaded under the card so it's clear which task it's about.
 * Forums: goes to the "Task events" topic (where the card normally is), replying across topics if not.
 */
export async function postGroupLine(ctx: BotContext, task: ITask, text: string) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const card = ctx.callbackQuery && 'message' in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
  const cardThread = topicOf(card as { is_topic_message?: boolean; message_thread_id?: number } | undefined);
  const extra = groupLineExtra(task);
  try {
    const group = await Group.findById(task.groupId).catch(() => null);
    if (!group || group.telegramGroupId !== chatId) {
      await ctx.telegram.sendMessage(chatId, text, {
        ...extra,
        ...(card ? { reply_parameters: { message_id: card.message_id, allow_sending_without_reply: true } } : {}),
      });
      return;
    }
    if (isForumChat(ctx) && !group.isForum) group.isForum = true;
    await groupMessengerService.sendEvent(ctx.telegram, group, text, {
      extra,
      // A link to the card is pointless if the card itself is gone.
      ...(card ? { source: { messageId: card.message_id, threadId: cardThread, linkFallback: false } } : {}),
      fallbackThreadId: cardThread,
    });
  } catch (error) {
    logger.warn(`Failed to post group line: ${error}`);
  }
}

/** Markdown, no previews, and one tap from the line to the task ("📱 Open #N" / "💬 View card") when possible. */
function groupLineExtra(task: ITask) {
  const open = taskButton(task);
  return {
    parse_mode: 'Markdown' as const,
    link_preview_options: { is_disabled: true },
    ...(open ? { reply_markup: { inline_keyboard: [[open]] } } : {}),
  };
}

/**
 * Same group line, for a change made outside the group (a DM quick action): posted as an event
 * in the task's group, replying to the card when there is one. Never sent to the DM itself.
 */
export async function postGroupLineFor(telegram: Telegram, group: IGroup, task: ITask, text: string) {
  try {
    const card =
      task.taskCardMessageId && task.taskCardChatId === group.telegramGroupId
        ? { messageId: task.taskCardMessageId, linkFallback: false }
        : undefined;
    await groupMessengerService.sendEvent(telegram, group, text, {
      extra: groupLineExtra(task),
      ...(card ? { source: card } : {}),
    });
  } catch (error) {
    logger.warn(`Failed to post group line for task ${task._id}: ${error}`);
  }
}

/** "#12 · Fix login" — the task reference every group line uses. */
export function taskRefLine(task: ITask): string {
  return `*#${task.taskNumber}* · ${shortTitle(task)}`;
}

export function shortTitle(task: ITask): string {
  return escapeMarkdown(truncate(task.title, 60));
}

