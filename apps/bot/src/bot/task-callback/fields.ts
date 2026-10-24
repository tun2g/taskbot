import { TASK_PRIORITY_ORDER, TASK_TYPE_ORDER, TaskPriority, TaskType } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { priorityLabel, priorityWord, typeLabel, typeWord } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { updateTaskCardMessage } from './card';

export async function handleSetPriority(ctx: BotContext, task: ITask, user: IUser, value: string) {
  if (!TASK_PRIORITY_ORDER.includes(value as TaskPriority)) {
    await ctx.answerCbQuery('That option is outdated.');
    return;
  }
  if (task.priority !== value) {
    const updatedTask = await taskService.updateTask(task._id, { priority: value });
    if (!updatedTask) {
      await ctx.answerCbQuery("Couldn't change the priority. Please try again.");
      return;
    }
    await taskActivityService.record({
      taskId: task._id,
      groupId: task.groupId,
      actor: user._id,
      action: 'priority',
      from: priorityLabel(task.priority),
      to: priorityLabel(value),
      via: 'bot',
    });
    task = updatedTask;
  }
  // No group message for priority changes — the card edit is enough.
  await updateTaskCardMessage(ctx, task);
  await ctx.answerCbQuery(`Priority: ${priorityWord(value)}`);
}

export async function handleSetType(ctx: BotContext, task: ITask, user: IUser, value: string) {
  if (!TASK_TYPE_ORDER.includes(value as TaskType)) {
    await ctx.answerCbQuery('That option is outdated.');
    return;
  }
  if (task.type !== value) {
    const updatedTask = await taskService.updateTask(task._id, { type: value });
    if (!updatedTask) {
      await ctx.answerCbQuery("Couldn't change the type. Please try again.");
      return;
    }
    await taskActivityService.record({
      taskId: task._id,
      groupId: task.groupId,
      actor: user._id,
      action: 'type',
      from: typeLabel(task.type),
      to: typeLabel(value),
      via: 'bot',
    });
    task = updatedTask;
  }
  await updateTaskCardMessage(ctx, task);
  await ctx.answerCbQuery(`Type: ${typeWord(value)}`);
}
