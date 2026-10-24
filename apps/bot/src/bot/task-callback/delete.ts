import { BotContext } from 'src/bot/interface/context';
import { cardSubtaskProgress } from 'src/bot/subtasks/card-progress';
import { cleanUpSubtasksAfterDelete } from 'src/bot/subtasks/parent-sync';
import { buildDeleteConfirmButtons, deleteConfirmText, mdName, refId } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import { renderCard } from './card';
import { shortTitle } from './group-line';

async function canDeleteTask(ctx: BotContext, task: ITask, user: IUser): Promise<boolean> {
  if (refId(task.createdBy) === user._id.toString()) return true;

  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  try {
    const member = await ctx.telegram.getChatMember(chatId, user.telegramUserId);
    return member.status === 'creator' || member.status === 'administrator';
  } catch (error) {
    logger.warn(`Could not check admin status for user ${user.telegramUserId}: ${error}`);
    return false;
  }
}

const DELETE_FORBIDDEN = 'Only the task creator or a group admin can delete this task.';

export async function handleDeleteRequest(ctx: BotContext, task: ITask, user: IUser) {
  if (!(await canDeleteTask(ctx, task, user))) {
    await ctx.answerCbQuery(DELETE_FORBIDDEN, { show_alert: true });
    return;
  }

  // Every subtask is kept, cancelled ones too.
  const progress = await cardSubtaskProgress(task);
  const subtasks = progress ? progress.total + progress.cancelled : 0;
  await renderCard(ctx, task, await buildDeleteConfirmButtons(task), deleteConfirmText(task, subtasks));
  await ctx.answerCbQuery('Confirm to delete');
}

export async function handleDelete(ctx: BotContext, task: ITask, user: IUser) {
  if (!(await canDeleteTask(ctx, task, user))) {
    await ctx.answerCbQuery(DELETE_FORBIDDEN, { show_alert: true });
    return;
  }

  const deleted = await taskService.deleteTask(task._id);
  if (!deleted) {
    await ctx.answerCbQuery("Couldn't delete the task. Please try again.");
    return;
  }

  await taskActivityService.record({
    taskId: task._id,
    groupId: task.groupId,
    actor: user._id,
    action: 'deleted',
    from: `#${task.taskNumber} ${task.title}`,
    to: null,
    via: 'bot',
  });
  // A deleted parent's subtasks stay as regular tasks; a deleted subtask is logged on its parent.
  const detached = await cleanUpSubtasksAfterDelete(task, user);

  // Edit the card in place instead of posting a new message.
  try {
    await ctx.editMessageText(
      `🗑 *#${task.taskNumber} deleted* by ${mdName(user)}\n${shortTitle(task)}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } },
    );
  } catch (error) {
    logger.warn(`Failed to update deleted task card: ${error}`);
  }

  await ctx.answerCbQuery(
    detached > 0
      ? `Deleted #${task.taskNumber} · its ${detached} subtask${detached === 1 ? ' is' : 's are'} now regular tasks`
      : `Deleted #${task.taskNumber}`,
  );
}
