import mongoose from 'mongoose';
import { bot } from 'src/bot';
import { buildTaskButtons, formatTaskCard, groupTimezone } from 'src/bot/task-card.renderer';
import { IGroup } from 'src/database/models/group.model';
import { ITask, Task } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import { groupService } from 'src/database/services/group.service';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import logger from 'src/shared/logger/logger';
import { CreatedTask, createdSummaryLines, escapeLegacyMarkdown } from 'src/shared/services/task-creation.service';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { buildUndoneText, UndoneTask } from 'src/shared/services/batch-undo.service';
import { boardButton, taskButton } from 'src/shared/utils/app-links';
import { Message } from 'telegraf/types';

import {
  buildChangeLine,
  buildDeleteLine,
  escapeHtml,
  TaskChange,
  userDisplayName,
} from 'src/shared/services/task-event-lines';

type SendExtra = NonNullable<Parameters<typeof bot.telegram.sendMessage>[2]>;

export type { TaskChange, TaskChangeField } from 'src/shared/services/task-event-lines';
export { buildChangeLine, buildDeleteLine, escapeHtml, shortTitle, userDisplayName } from 'src/shared/services/task-event-lines';

function isUserDoc(value: unknown): value is IUser {
  return !!value && typeof value === 'object' && 'telegramUserId' in (value as object);
}

export class TaskSyncService {
  /**
   * Refresh the task card in the group chat.
   * - Card exists → edit it in place.
   * - No card → post one ONLY when `created` is set (task just created from the app).
   *   AI batch tasks have no card on purpose, so an update must never spawn one.
   * `via` ("app", "Claude Code"…) adds "(via …)" under a newly posted card, like the cards of app/MCP batches.
   */
  async syncTaskCard(task: ITask, options: { created?: boolean; via?: string } = {}) {
    try {
      const fullTask = await Task.findById(task._id).populate(TASK_POPULATE);
      if (!fullTask) return;

      const creator = isUserDoc(fullTask.createdBy) ? fullTask.createdBy : null;
      const assignee = isUserDoc(fullTask.assigneeId) ? fullTask.assigneeId : null;

      const text = formatTaskCard(fullTask, creator, assignee);
      const buttons = await buildTaskButtons(fullTask);

      if (fullTask.taskCardMessageId && fullTask.taskCardChatId) {
        try {
          await bot.telegram.editMessageText(fullTask.taskCardChatId, fullTask.taskCardMessageId, undefined, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons },
          });
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          if (!errMsg.includes('message is not modified')) {
            logger.warn(`Could not edit task card for task ${fullTask._id}: ${errMsg}`);
          }
        }
        return;
      }

      if (options.created && fullTask.taskCardChatId) {
        const body = options.via ? `${text}\n\n_(via ${escapeLegacyMarkdown(options.via)})_` : text;
        const newMsg = await this.postEvent(fullTask.groupId, fullTask.taskCardChatId, body, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons },
        });
        await Task.findByIdAndUpdate(fullTask._id, { $set: { taskCardMessageId: newMsg.message_id } });
      }
    } catch (error) {
      logger.error(`Task sync error: ${error}`);
    }
  }

  /**
   * Post one combined line about an app PATCH (only for status / assignee / title changes).
   * `via` is the channel in "(via …)" — "app" by default, or the MCP client ("Claude Code").
   */
  async postChangeSummary(
    task: ITask,
    actorUserId: mongoose.Types.ObjectId | string,
    changes: TaskChange[],
    via = 'app',
  ) {
    try {
      const actor = await User.findById(actorUserId);
      const line = buildChangeLine(userDisplayName(actor), task.taskNumber, task.title, changes, via);
      if (!line) return;

      // One tap from the group line to the task itself (no hunting on the board).
      const open = taskButton(task);
      await this.postEvent(task.groupId, task.taskCardChatId, line, {
        parse_mode: 'HTML',
        ...(open ? { reply_markup: { inline_keyboard: [[open]] } } : {}),
      });
    } catch (error) {
      logger.error(`Change summary error for task ${task._id}: ${error}`);
    }
  }

  /** After a delete from the app: remove the card (best effort) and tell the group. */
  async onTaskDeleted(task: ITask, actorUserId: mongoose.Types.ObjectId | string, via = 'app') {
    try {
      if (task.taskCardChatId && task.taskCardMessageId) {
        await bot.telegram.deleteMessage(task.taskCardChatId, task.taskCardMessageId).catch(() => {});
      }

      const actor = await User.findById(actorUserId);
      await this.postEvent(task.groupId, task.taskCardChatId, buildDeleteLine(userDisplayName(actor), task.taskNumber, task.title, via), {
        parse_mode: 'HTML',
      });
    } catch (error) {
      logger.error(`Delete notification error for task ${task._id}: ${error}`);
    }
  }

  /**
   * Tasks created from the web chat: ONE group message, marked "(via app)" and without ↩️ Undo
   * (undo lives in the web chat). 1 task → its card (taskCardMessageId stored so later edits
   * refresh it); 2+ → a summary. Returns the posted message, or null when posting failed.
   * `via` replaces "app" in "(via app)" (e.g. "Claude Code" for tasks created through MCP).
   */
  async postCreatedFromApp(
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
        `<b>🤖 ${escapeHtml(userDisplayName(requester))} created ${created.length} tasks (via ${escapeHtml(via)})</b>`,
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
  async markBatchUndone(
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

  /**
   * Posts an app/web event to the task's group: through the group messenger (forums: the
   * "Task events" topic, else General — there's no command topic to fall back to). Falls back
   * to a plain message in the card's chat if the group can't be loaded. Throws if nothing can be sent.
   */
  private async postEvent(
    groupId: ITask['groupId'] | undefined,
    cardChatId: number | undefined,
    text: string,
    extra: SendExtra,
  ): Promise<Message.TextMessage> {
    const group = groupId ? await groupService.findGroupById(groupId) : null;
    if (group && (!cardChatId || group.telegramGroupId === cardChatId)) {
      return groupMessengerService.sendEvent(bot.telegram, group, text, { extra });
    }
    const chatId = cardChatId ?? group?.telegramGroupId;
    if (!chatId) throw new Error('No chat to post the task event in');
    return bot.telegram.sendMessage(chatId, text, extra);
  }
}

export const taskSyncService = new TaskSyncService();
