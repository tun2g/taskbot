import { BotContext } from 'src/bot/interface/context';
import { Group } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import { AI_UNAVAILABLE_MESSAGE, aiCommandService, checkUserAiRateLimit } from 'src/shared/services/ai-command.service';
import { aiDisabledBy, aiDisabledText, aiGroupLimitText, aiUserLimitText } from 'src/shared/services/ai-quota';
import { topicOf } from 'src/shared/services/group-messenger.service';
import { checkGroupAiRateLimit } from 'src/shared/services/task-creation.service';
import { groupUnavailableToast, isGroupActive } from 'src/shared/utils/group-status';
import { canChangeFromDm } from './membership';

// ── 💡 Explain (card ⋯ More, DM notifications) ──

/**
 * A short AI explanation of ONE task, without the /ai planner. Same membership rule as DM quick actions
 * and the same rate limits as /ai. In a DM it arrives as a new message (with the task's state and Open
 * button); in the group it is threaded under the card — one message, nothing else posted.
 */
export async function handleExplain(ctx: BotContext, task: ITask, user: IUser, options: { onCard: boolean }) {
  const group = await Group.findById(task.groupId).catch(() => null);
  const chatId = ctx.chat?.id;
  if (!group || !chatId) {
    await ctx.answerCbQuery("Couldn't find this task's group.", { show_alert: true });
    return;
  }
  // Pressing the card in its own group proves membership; anywhere else, check it.
  const inOwnGroup = chatId === group.telegramGroupId;
  // From a DM the group gate never ran: a paused / unapproved group's tasks get no AI either.
  if (!isGroupActive(group)) {
    await ctx.answerCbQuery(groupUnavailableToast(group, { named: !inOwnGroup }), { show_alert: true });
    return;
  }
  if (!inOwnGroup && !(await canChangeFromDm(ctx.telegram, group, task, user))) {
    await ctx.answerCbQuery("You can't see this task — you're not in its group anymore.", { show_alert: true });
    return;
  }

  const disabledBy = aiDisabledBy(group, user);
  if (disabledBy) {
    await ctx.answerCbQuery(`🚫 ${aiDisabledText(disabledBy, group, user, 80)}`, { show_alert: true });
    return;
  }

  const userLimit = await checkUserAiRateLimit(user.telegramUserId, group.telegramGroupId, user);
  if (!userLimit.allowed) {
    await ctx.answerCbQuery(`⏳ ${aiUserLimitText(userLimit, group)}`, { show_alert: true });
    return;
  }
  const groupLimit = await checkGroupAiRateLimit(group.telegramGroupId, group);
  if (!groupLimit.allowed) {
    await ctx.answerCbQuery(`⏳ ${aiGroupLimitText(group, groupLimit)}`, { show_alert: true });
    return;
  }

  // Answer the tap right away: the explanation can take a few seconds.
  await ctx.answerCbQuery(`💡 Explaining #${task.taskNumber}…`);
  void Promise.resolve(ctx.sendChatAction?.('typing')).catch(() => undefined);

  const card = ctx.callbackQuery && 'message' in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
  const thread = options.onCard
    ? topicOf(card as { is_topic_message?: boolean; message_thread_id?: number } | undefined)
    : undefined;
  const extra = {
    parse_mode: 'HTML' as const,
    link_preview_options: { is_disabled: true },
    ...(options.onCard && card
      ? { reply_parameters: { message_id: card.message_id, allow_sending_without_reply: true } }
      : {}),
    ...(thread !== undefined ? { message_thread_id: thread } : {}),
  };

  try {
    const reply = await aiCommandService.explainTaskById(task._id.toString(), user, group, { onCard: options.onCard });
    if (!reply) {
      await ctx.telegram.sendMessage(chatId, '❌ This task no longer exists.', extra);
      return;
    }
    await ctx.telegram.sendMessage(chatId, reply.text, {
      ...extra,
      ...(reply.buttons ? { reply_markup: { inline_keyboard: reply.buttons } } : {}),
    });
  } catch (error) {
    logger.error(`Explain #${task.taskNumber} failed: ${error instanceof Error ? error.stack : error}`);
    await ctx.telegram.sendMessage(chatId, AI_UNAVAILABLE_MESSAGE, extra).catch(() => undefined);
  }
}
