import { bot } from 'src/bot';
import { buildTaskButtons, formatTaskCard, groupTimezone } from 'src/bot/task-card.renderer';
import { IGroup } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { buildUndoneText, UndoneTask } from 'src/shared/services/batch-undo.service';
import { createdSummaryHeader } from 'src/shared/services/created-summary';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { CreatedTask, createdSummaryLines, escapeLegacyMarkdown } from 'src/shared/services/task-creation.service';
import { userDisplayName } from 'src/shared/services/task-event-lines';
import { boardButton } from 'src/shared/utils/app-links';

/**
 * Tasks created from the web chat: ONE group message, marked "(via app)" and without ↩️ Undo
 * (undo lives in the web chat). 1 task → its card (taskCardMessageId stored so later edits
 * refresh it); 2+ → a summary. Returns the posted message, or null when posting failed.
 * `via` replaces "app" in "(via app)" (e.g. "Claude Code" for tasks created through MCP).
 */
export async function postCreatedFromApp(
  group: IGroup,
  requester: IUser,
  created: CreatedTask[],
  via = 'app',
): Promise<{ chatId: number; messageId: number } | null> {
  const chatId = group.telegramGroupId;
  if (!chatId || created.length === 0) return null;
  try {
    if (created.length === 1) {
      const { task, assignee } = created[0];
      const text = `${formatTaskCard(task, requester, assignee, groupTimezone(group))}\n\n_(via ${escapeLegacyMarkdown(via)})_`;
      const buttons = await buildTaskButtons(task);
      const sent = await groupMessengerService.sendEvent(bot.telegram, group, text, {
        extra: {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: buttons },
        },
      });
      await Task.findByIdAndUpdate(task._id, { $set: { taskCardMessageId: sent.message_id, taskCardChatId: chatId } });
      task.taskCardMessageId = sent.message_id;
      task.taskCardChatId = chatId;
      return { chatId, messageId: sent.message_id };
    }

    const lines = [
      createdSummaryHeader(
        userDisplayName(requester),
        created.map((c) => c.task),
        via,
      ),
      '',
      ...createdSummaryLines(created, group._id),
    ];
    const board = boardButton(group._id);
    const sent = await groupMessengerService.sendEvent(bot.telegram, group, lines.join('\n'), {
      extra: {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(board ? { reply_markup: { inline_keyboard: [[board]] } } : {}),
      },
    });
    return { chatId, messageId: sent.message_id };
  } catch (error) {
    logger.error(`Could not post app-created tasks to group ${group._id}: ${error}`);
    return null;
  }
}

/**
 * After an undo from the web chat: turn the group post into "↩️ Undone by X (via app) · N tasks removed"
 * with the removed tasks struck through and the board button (the task buttons go away with the tasks).
 * `groupId` defaults to the group of `post.chatId`.
 */
export async function markBatchUndone(
  post: { chatId: number; messageId: number },
  actorName: string,
  removed: number,
  tasks: UndoneTask[] = [],
  groupId?: IGroup['_id'] | string,
  via = 'app',
) {
  const text = buildUndoneText({ actorName, removed, tasks, viaLabel: via });
  try {
    const gid = groupId ?? (await groupService.findGroupByTelegramId(post.chatId))?._id;
    const board = gid ? boardButton(gid) : null;
    await bot.telegram.editMessageText(post.chatId, post.messageId, undefined, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(board ? { reply_markup: { inline_keyboard: [[board]] } } : {}),
    });
  } catch (error) {
    logger.warn(`Could not mark batch post ${post.messageId} as undone: ${error}`);
  }
}
