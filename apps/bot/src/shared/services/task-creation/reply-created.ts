import { randomBytes } from 'crypto';
import { BotContext } from 'src/bot/interface/context';
import { buildTaskButtons, formatTaskCard } from 'src/bot/task-card.renderer';
import { taskService } from 'src/database/services/task.service';
import { BATCH_CALLBACK_PREFIX, BatchCallbackData } from 'src/shared/services/batch-undo.constants';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { groupMessengerService, isForumChat } from 'src/shared/services/group-messenger.service';
import { ReplyProgress } from 'src/shared/services/task-creation/reply-progress';
import { createdSummaryLines } from 'src/shared/services/task-creation/summary';
import { escapeHtml, escapeLegacyMarkdown, messageLink, userName } from 'src/shared/services/task-creation/text';
import { CreateTasksInput, CreateTasksResult, SendExtra } from 'src/shared/services/task-creation/types';
import { boardButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

type Created = Extract<CreateTasksResult, { status: 'created' }>;
type Post = (text: string, extra: SendExtra, linkFallback: boolean) => Promise<number | undefined>;
type EventSource = { messageId: number; threadId?: number } | undefined;

/** Posts the result: the task card for 1 task, a summary with ↩️ Undo for 2+. */
export async function replyCreated(ctx: BotContext, progress: ReplyProgress, input: CreateTasksInput, result: Created) {
  const { group, messages } = input;

  // Forums: the card/summary goes to the "Task events" topic as a reply to the source message.
  const forum = isForumChat(ctx) || !!group.isForum;
  const eventSource = messages[0] ? { messageId: messages[0].messageId, threadId: messages[0].threadId } : undefined;
  const post: Post = async (text, extra, linkFallback) => {
    if (!forum) return progress.finish(text, extra);
    await progress.cancel();
    const { message } = await groupMessengerService.sendCommandEvent(ctx, group, text, {
      extra,
      ...(eventSource?.messageId ? { source: { ...eventSource, linkFallback } } : {}),
    });
    return message?.message_id;
  };

  if (result.created.length === 1) return replyCard(ctx, input, result, post);
  return replySummary(ctx, input, result, post, eventSource);
}

async function replyCard(ctx: BotContext, input: CreateTasksInput, result: Created, post: Post) {
  const chatId = ctx.chat!.id;
  const { task, assignee } = result.created[0];
  let text = formatTaskCard(task, input.requester, assignee);
  if (result.warnings.length) text += `\n\n${escapeLegacyMarkdown(result.warnings.join('\n'))}`;
  const buttons = await buildTaskButtons(task);
  // The card already links its source message, so no extra link if the cross-topic reply fails.
  const messageId = await post(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }, false);
  if (messageId) await taskService.updateTask(task._id, { taskCardMessageId: messageId, taskCardChatId: chatId });
}

async function replySummary(ctx: BotContext, input: CreateTasksInput, result: Created, post: Post, eventSource: EventSource) {
  const { requester, group, messages } = input;
  const { created, warnings, batchId } = result;
  const chatId = ctx.chat!.id;

  const key = randomBytes(6).toString('hex');
  const batch: BatchCallbackData = {
    batchId,
    groupId: group._id.toString(),
    chatId,
    requesterTelegramId: requester.telegramUserId,
    requesterName: userName(requester),
    count: created.length,
    createdAt: Date.now(),
  };
  await callbackDataStorageService.setCallbackData(key, BATCH_CALLBACK_PREFIX, batch);

  // The source label links to the (first) source message, so it doubles as the cross-topic fallback link.
  const sourceLabel = messages.length === 1 ? 'this message' : `${messages.length} messages`;
  const sourceUrl = eventSource ? messageLink(chatId, eventSource.messageId, eventSource.threadId) : '';
  const source = sourceUrl ? `<a href="${sourceUrl}">${sourceLabel}</a>` : sourceLabel;
  const lines = [`<b>🤖 Created ${created.length} tasks from ${source}</b>`, '', ...createdSummaryLines(created, group._id)];
  if (warnings.length) lines.push('', ...warnings.map(escapeHtml));

  const row: InlineKeyboardButton[] = [{ text: '↩️ Undo', callback_data: `batch:undo:${key}` }];
  const board = boardButton(group._id);
  if (board) row.push(board);

  await post(
    lines.join('\n'),
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [row] },
    },
    !sourceUrl,
  );
}
