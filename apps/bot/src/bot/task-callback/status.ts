import { TASK_STATUS_ORDER, TaskStatus } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { closeAnywayCardRows, closeAnywayText, openSubtasksBlockingClose } from 'src/bot/subtasks/close-guard';
import { refreshParentAfterStatus } from 'src/bot/subtasks/parent-sync';
import { parentSuffix, populatedParent } from 'src/bot/subtasks/subtask-lines';
import { mdName, populatedUser, statusLabel, statusWord } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
import { findUser, renderCard, updateTaskCardMessage } from './card';
import { postGroupLine, taskRefLine } from './group-line';

/** Group line verb for a move into a status. */
function statusVerb(from: string, to: string): string {
  switch (to) {
    case 'in_progress':
      return from === 'pending' ? 'resumed' : 'started';
    case 'in_review':
      return 'sent for review';
    case 'done':
      return 'finished';
    case 'cancelled':
      return 'cancelled';
    case 'pending':
      return 'put on hold';
    case 'backlog':
      return 'moved to Backlog';
    default:
      return from === 'done' || from === 'cancelled' ? 'reopened' : 'moved to To do';
  }
}

export async function handleStatusChange(ctx: BotContext, task: ITask, newStatus: string, user: IUser, force = false) {
  if (!TASK_STATUS_ORDER.includes(newStatus as TaskStatus)) {
    await ctx.answerCbQuery('That option is outdated.');
    return;
  }

  const openSubtasks = force ? 0 : await openSubtasksBlockingClose(task, newStatus);
  if (openSubtasks > 0) {
    const rows = await closeAnywayCardRows(task, newStatus);
    await renderCard(ctx, task, rows, closeAnywayText(task.taskNumber, openSubtasks, newStatus));
    await ctx.answerCbQuery(`${openSubtasks} subtask${openSubtasks === 1 ? ' is' : 's are'} still open`);
    return;
  }

  if (task.status === newStatus) {
    await updateTaskCardMessage(ctx, task);
    await ctx.answerCbQuery(`Already ${statusWord(newStatus).toLowerCase()}`);
    return;
  }

  const updatedTask = await applyStatusChange(task, newStatus, user);
  if (!updatedTask) {
    await ctx.answerCbQuery("Couldn't update the status. Please try again.");
    return;
  }

  await updateTaskCardMessage(ctx, updatedTask);
  await ctx.answerCbQuery(`Status: ${statusWord(newStatus)}`);

  await postGroupLine(ctx, updatedTask, statusLine(user, task.status, updatedTask));
  await notifyAssigneeOfStatus(updatedTask, user);
}

/** Shared by the group card and DM quick actions: update the status and record the activity. */
export async function applyStatusChange(task: ITask, newStatus: string, user: IUser): Promise<ITask | null> {
  const updatedTask = await taskService.updateTaskStatus(task._id, newStatus, user._id);
  if (!updatedTask) return null;

  await taskActivityService.record({
    taskId: task._id,
    groupId: task.groupId,
    actor: user._id,
    action: 'status',
    from: statusLabel(task.status),
    to: statusLabel(newStatus),
    via: 'bot',
  });
  // A subtask finishing / reopening moves its parent card's "🧩 Subtasks: 2/5 done".
  refreshParentAfterStatus(updatedTask, task.status, newStatus).catch(() => {});
  return updatedTask;
}

/** "✅ @bob finished *#12* · Fix login" (+ " (↳ #10)" for a subtask) */
export function statusLine(user: IUser, from: string, updatedTask: ITask): string {
  const emoji = statusLabel(updatedTask.status).split(' ')[0];
  const parent = parentSuffix(populatedParent(updatedTask.parentTaskId));
  return `${emoji} ${mdName(user)} ${statusVerb(from, updatedTask.status)} ${taskRefLine(updatedTask)}${parent}`;
}

export async function notifyAssigneeOfStatus(updatedTask: ITask, user: IUser) {
  const assignee = populatedUser(updatedTask.assigneeId) ?? (await findUser(updatedTask.assigneeId));
  if (assignee && assignee.telegramUserId !== user.telegramUserId) {
    await notificationService.notifyStatusChange(updatedTask, user, assignee);
  }
}
