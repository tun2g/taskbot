import { BotContext } from 'src/bot/interface/context';
import { cardSubtaskProgress } from 'src/bot/subtasks/card-progress';
import { refreshParentAfterStatus } from 'src/bot/subtasks/parent-sync';
import { parentSuffix, populatedParent } from 'src/bot/subtasks/subtask-lines';
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
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import { notificationService } from 'src/shared/services/notification.service';
import { InlineKeyboardButton } from 'telegraf/types';

/** `reply_markup` with a single button, or nothing when there's no link to offer. */
export function withButton(button: InlineKeyboardButton | null) {
  return button ? { reply_markup: { inline_keyboard: [[button]] } } : {};
}

/** "✅ @me finished *#45* · Write tests (↳ #42)" */
export function finishedLine(user: IUser, task: ITask): string {
  const parent = parentSuffix(populatedParent(task.parentTaskId));
  return `✅ ${mdName(user)} finished *#${task.taskNumber}* · ${escapeMarkdown(truncate(task.title, 60))}${parent}`;
}

/** Status → done plus the activity entry; null when the update failed. */
export async function markDone(task: ITask, user: IUser): Promise<ITask | null> {
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
export async function afterDone(ctx: BotContext, task: ITask, updatedTask: ITask, user: IUser, group: IGroup | null) {
  await refreshTaskCard(ctx, updatedTask, group);
  refreshParentAfterStatus(updatedTask, task.status, 'done').catch(() => {});

  const assignee = populatedUser(updatedTask.assigneeId);
  if (assignee && assignee.telegramUserId !== user.telegramUserId) {
    await notificationService.notifyStatusChange(updatedTask, user, assignee);
  }
}

/** Edit the original task card so it doesn't keep showing stale buttons. */
async function refreshTaskCard(ctx: BotContext, task: ITask, group: IGroup | null) {
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
