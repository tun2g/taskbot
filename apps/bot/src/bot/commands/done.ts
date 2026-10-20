import { replyGroupOnly } from 'src/bot/commands/private-chat-hint';
import { BotContext } from 'src/bot/interface/context';
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
  truncate,
} from 'src/bot/task-card.renderer';
import { IGroup } from 'src/database/models/group.model';
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

    const updatedTask = await taskService.updateTaskStatus(task._id, 'done', user._id);
    if (!updatedTask) {
      await ctx.reply(`❌ Couldn't update #${task.taskNumber}. Please try again.`, withButton(taskButton(task)));
      return;
    }

    await taskActivityService.record({
      taskId: task._id,
      groupId: task.groupId,
      actor: user._id,
      action: 'status',
      from: statusLabel(task.status),
      to: statusLabel('done'),
      via: 'bot',
    });

    // An event: forums post it in "Task events" (👌 on the command); normal groups reply here as before.
    await groupMessengerService.sendCommandEvent(
      ctx,
      group,
      `✅ ${mdName(user)} finished *#${updatedTask.taskNumber}* · ${escapeMarkdown(truncate(updatedTask.title, 60))}`,
      { extra: { parse_mode: 'Markdown', ...withButton(taskButton(updatedTask)) } },
    );

    await this.refreshTaskCard(ctx, updatedTask, group);

    const assignee = populatedUser(updatedTask.assigneeId);
    if (assignee && assignee.telegramUserId !== user.telegramUserId) {
      await notificationService.notifyStatusChange(updatedTask, user, assignee);
    }
  }

  /** Edit the original task card so it doesn't keep showing stale buttons. */
  private async refreshTaskCard(ctx: BotContext, task: ITask, group: IGroup) {
    if (!task.taskCardChatId || !task.taskCardMessageId) return;
    try {
      const text = formatTaskCard(task, undefined, undefined, groupTimezone(group));
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

export const doneCommand = new DoneCommand();
