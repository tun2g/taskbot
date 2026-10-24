import { BotContext } from 'src/bot/interface/context';
import {
  displayName,
  escapeMarkdown,
  mdName,
  populatedUser,
  refId,
  storeTaskCallbackData,
  truncate,
} from 'src/bot/task-card.renderer';
import { configService } from 'src/configs/configuration';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
import { InlineKeyboardButton } from 'telegraf/types';
import { findUser, showKeyboard, updateTaskCardMessage } from './card';
import { postGroupLine, taskRefLine } from './group-line';

export async function handleShowAssignPicker(ctx: BotContext, task: ITask) {
  const members = await groupMemberService.getMembers(task.groupId);
  const currentAssigneeId = refId(task.assigneeId);

  const rows: InlineKeyboardButton[][] = [];
  let row: InlineKeyboardButton[] = [];

  for (const member of members) {
    const isAssignee = currentAssigneeId === member._id.toString();
    const cbData = await storeTaskCallbackData(task._id.toString(), 'assign_to', {
      assigneeUserId: member._id.toString(),
    });
    row.push({ text: `${isAssignee ? '✅ ' : ''}${truncate(displayName(member), 24)}`, callback_data: cbData });
    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) rows.push(row);

  const bottom: InlineKeyboardButton[] = [];
  if (currentAssigneeId) {
    bottom.push({ text: '🚫 Unassign', callback_data: await storeTaskCallbackData(task._id.toString(), 'unassign') });
  }
  bottom.push({ text: '« Back', callback_data: await storeTaskCallbackData(task._id.toString(), 'assign_cancel') });
  rows.push(bottom);

  await showKeyboard(
    ctx,
    rows,
    members.length ? 'Who should do this?' : "I don't know anyone here yet — members appear after they send a message.",
  );
}

function dmHint(name: string): string {
  const bot = configService.botUsername ? `@${escapeMarkdown(configService.botUsername)}` : 'me';
  return `\n(${name} hasn't started a private chat with me, so they won't get DMs — they can tap ${bot} → Start)`;
}

export async function handleAssignTo(ctx: BotContext, task: ITask, actingUser: IUser, assigneeUserId: string) {
  const assignee = await findUser(assigneeUserId);
  if (!assignee) {
    await ctx.answerCbQuery("I can't find that person anymore. Pick someone else.");
    return;
  }

  if (refId(task.assigneeId) === assignee._id.toString()) {
    await updateTaskCardMessage(ctx, task);
    await ctx.answerCbQuery(`Already assigned to ${displayName(assignee)}`);
    return;
  }

  const previous = populatedUser(task.assigneeId);
  const updatedTask = await taskService.assignTask(task._id, assignee._id);
  if (!updatedTask) {
    await ctx.answerCbQuery("Couldn't change the assignee. Please try again.");
    return;
  }

  await taskActivityService.record({
    taskId: task._id,
    groupId: task.groupId,
    actor: actingUser._id,
    action: 'assignee',
    from: previous ? displayName(previous) : null,
    to: displayName(assignee),
    via: 'bot',
  });

  await updateTaskCardMessage(ctx, updatedTask);
  await ctx.answerCbQuery(`Assigned to ${displayName(assignee)}`);

  const result = await notificationService.notifyAssignment(updatedTask, assignee, actingUser);

  const self = assignee.telegramUserId === actingUser.telegramUserId;
  let line = self
    ? `👤 ${mdName(actingUser)} took ${taskRefLine(updatedTask)}`
    : `👤 ${mdName(actingUser)} assigned ${taskRefLine(updatedTask)} to ${mdName(assignee)}`;
  if (result === 'not_started') line += dmHint(mdName(assignee));
  await postGroupLine(ctx, updatedTask, line);

  if (previous && previous.telegramUserId !== assignee.telegramUserId) {
    await notificationService.notifyUnassigned(updatedTask, previous, actingUser);
  }
}

export async function handleUnassign(ctx: BotContext, task: ITask, actingUser: IUser) {
  const previous = populatedUser(task.assigneeId) ?? (await findUser(task.assigneeId));
  if (!previous) {
    await updateTaskCardMessage(ctx, task);
    await ctx.answerCbQuery('Nobody is assigned');
    return;
  }

  const updatedTask = await taskService.assignTask(task._id, null);
  if (!updatedTask) {
    await ctx.answerCbQuery("Couldn't change the assignee. Please try again.");
    return;
  }

  await taskActivityService.record({
    taskId: task._id,
    groupId: task.groupId,
    actor: actingUser._id,
    action: 'assignee',
    from: displayName(previous),
    to: null,
    via: 'bot',
  });

  await updateTaskCardMessage(ctx, updatedTask);
  await ctx.answerCbQuery('Unassigned');

  await postGroupLine(
    ctx,
    updatedTask,
    `🚫 ${mdName(actingUser)} unassigned ${mdName(previous)} from ${taskRefLine(updatedTask)}`,
  );
  await notificationService.notifyUnassigned(updatedTask, previous, actingUser);
}
