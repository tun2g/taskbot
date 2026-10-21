import { replyGroupOnly } from 'src/bot/commands/private-chat-hint';
import { BotContext } from 'src/bot/interface/context';
import { cardSubtaskProgress } from 'src/bot/subtasks/card-progress';
import { closeAnywayButtonText, closeAnywayText, openSubtasksBlockingClose } from 'src/bot/subtasks/close-guard';
import { refreshParentAfterStatus } from 'src/bot/subtasks/parent-sync';
import { parentSuffix, populatedParent } from 'src/bot/subtasks/subtask-lines';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import {
  buildTaskButtons,
  escapeMarkdown,
  formatTaskCard,
  groupTimezone,
  mdName,
  populatedUser,
  statusLabel,
  storeTaskCallbackData,
  truncate,
} from 'src/bot/task-card.renderer';
import { Group, IGroup } from 'src/database/models/group.model';
import { groupService } from 'src/database/services/group.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { notificationService } from 'src/shared/services/notification.service';
import { taskButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

/** `reply_markup` with a single button, or nothing when there's no link to offer. */
function withButton(button: InlineKeyboardButton | null) {
  return button ? { reply_markup: { inline_keyboard: [[button]] } } : {};
}

export class DoneCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('done', this.onDone.bind(this));
    return this.map;
  }

  async onDone(ctx: BotContext) {
    try {
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;

      if (!chatId || (chatType !== 'group' && chatType !== 'supergroup')) {
        await replyGroupOnly(ctx, 'done');
        return;
      }

      const user = await userService.findOrCreateUser(ctx);
      if (!user) return;

      const chatTitle = 'title' in ctx.chat! ? (ctx.chat as { title: string }).title : 'Group';
      const group = await groupService.findOrCreateGroup(chatId, chatTitle);
      if (!group) {
        await ctx.reply('❌ Could not find this group.');
        return;
      }

      const message = ctx.message;
      if (!message) return;
      const messageText = 'text' in message ? message.text || '' : '';
      const args = messageText.replace(/^\/done(@\w+)?\s*/, '').trim();

      // Method 1: /done #123 — by task number
      const numberMatch = args.match(/^#?(\d+)$/);
      if (numberMatch) {
        const taskNumber = parseInt(numberMatch[1], 10);
        const task = await taskService.getTaskByNumber(group._id, taskNumber);

        if (!task) {
          await ctx.reply(`❌ Task #${taskNumber} not found in this group. Use /list to see the open ones.`);
          return;
        }

        await this.completeTask(ctx, task, user, group);
        return;
      }

      // Method 2: reply to a task card with /done
      const replyTo = 'reply_to_message' in message ? message.reply_to_message : null;
      if (!args && replyTo) {
        const task = await taskService.getTaskByCardMessage(chatId, replyTo.message_id);
        if (!task) {
          await ctx.reply("❌ That message isn't a task card. Reply to a task card or use `/done #123`.", {
            parse_mode: 'Markdown',
          });
          return;
        }

        await this.completeTask(ctx, task, user, group);
        return;
      }

      if (!args) {
        await ctx.reply(
          '📋 *Usage:*\n' +
            '• `/done #123` — mark task #123 as done\n' +
            '• `/done 123` — same as above\n' +
            '• Reply to a task card with `/done`',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      await ctx.reply('❌ Invalid task number. Use `/done #123` or `/done 123`.', {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      logger.error(`Error in /done command: ${error}`);
      await ctx.reply('❌ Failed to complete task. Please try again.');
    }
  }

  private async completeTask(ctx: BotContext, task: ITask, user: IUser, group: IGroup) {
    if (task.status === 'done') {
      await ctx.reply(`ℹ️ Task #${task.taskNumber} is already done.`, withButton(taskButton(task)));
      return;
    }

    // A parent with open subtasks: ask first (answered by `close_anyway` → confirmClose).
    const openSubtasks = await openSubtasksBlockingClose(task, 'done');
    if (openSubtasks > 0) {
      const open = taskButton(task);
      const yes = {
        text: closeAnywayButtonText(task.taskNumber, 'done'),
        callback_data: await storeTaskCallbackData(String(task._id), 'close_anyway'),
      };
      await ctx.reply(closeAnywayText(task.taskNumber, openSubtasks, 'done'), {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[yes, ...(open ? [open] : [])]] },
      });
      return;
    }

    const updatedTask = await this.markDone(task, user);
    if (!updatedTask) {
      await ctx.reply(`❌ Couldn't update #${task.taskNumber}. Please try again.`, withButton(taskButton(task)));
      return;
    }

    // An event: forums post it in "Task events" (👌 on the command); normal groups reply here as before.
    await groupMessengerService.sendCommandEvent(ctx, group, finishedLine(user, updatedTask), {
      extra: { parse_mode: 'Markdown', ...withButton(taskButton(updatedTask)) },
    });
    await this.afterDone(ctx, task, updatedTask, user, group);
  }

  /** "✅ Yes, close #42" under the open-subtasks question: close it and turn the question into the event line. */
  async confirmClose(ctx: BotContext, task: ITask, user: IUser) {
    if (task.status === 'done') {
      await ctx.answerCbQuery(`#${task.taskNumber} is already done`);
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      return;
    }
    const updatedTask = await this.markDone(task, user);
    if (!updatedTask) {
      await ctx.answerCbQuery("Couldn't update the status. Please try again.");
      return;
    }
    await ctx.answerCbQuery(`#${task.taskNumber}: Done`);
    await ctx
      .editMessageText(finishedLine(user, updatedTask), {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        ...withButton(taskButton(updatedTask)),
      })
      .catch((error) => logger.warn(`Could not edit the close question for #${task.taskNumber}: ${error}`));
    const group = await Group.findById(task.groupId).catch(() => null);
    await this.afterDone(ctx, task, updatedTask, user, group);
  }

  private async markDone(task: ITask, user: IUser): Promise<ITask | null> {
    const updatedTask = await taskService.updateTaskStatus(task._id, 'done', user._id);
    if (!updatedTask) return null;
    await taskActivityService.record({
      taskId: task._id,
      groupId: task.groupId,
      actor: user._id,
      action: 'status',
      from: statusLabel(task.status),
      to: statusLabel('done'),
      via: 'bot',
    });
    return updatedTask;
  }

  /** Card, parent card and assignee DM after a /done. */
  private async afterDone(ctx: BotContext, task: ITask, updatedTask: ITask, user: IUser, group: IGroup | null) {
    await this.refreshTaskCard(ctx, updatedTask, group);
    refreshParentAfterStatus(updatedTask, task.status, 'done').catch(() => {});

    const assignee = populatedUser(updatedTask.assigneeId);
    if (assignee && assignee.telegramUserId !== user.telegramUserId) {
      await notificationService.notifyStatusChange(updatedTask, user, assignee);
    }
  }

  /** Edit the original task card so it doesn't keep showing stale buttons. */
  private async refreshTaskCard(ctx: BotContext, task: ITask, group: IGroup | null) {
    if (!task.taskCardChatId || !task.taskCardMessageId) return;
    try {
      const text = formatTaskCard(task, undefined, undefined, groupTimezone(group), await cardSubtaskProgress(task));
      const buttons = await buildTaskButtons(task);
      await ctx.telegram.editMessageText(task.taskCardChatId, task.taskCardMessageId, undefined, text, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (error) {
      if (!String(error).includes('message is not modified')) {
        logger.warn(`Could not refresh task card for #${task.taskNumber}: ${error}`);
      }
    }
  }
}

/** "✅ @me finished *#45* · Write tests (↳ #42)" */
function finishedLine(user: IUser, task: ITask): string {
  const parent = parentSuffix(populatedParent(task.parentTaskId));
  return `✅ ${mdName(user)} finished *#${task.taskNumber}* · ${escapeMarkdown(truncate(task.title, 60))}${parent}`;
}

export const doneCommand = new DoneCommand();
