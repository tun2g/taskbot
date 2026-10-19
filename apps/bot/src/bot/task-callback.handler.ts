import { TASK_PRIORITY_ORDER, TASK_STATUS_ORDER, TASK_TYPE_ORDER, TaskPriority, TaskStatus, TaskType } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import {
  buildDeleteConfirmButtons,
  buildMoreButtons,
  buildPriorityPicker,
  buildStatusPicker,
  buildTaskButtons,
  buildTypePicker,
  deleteConfirmText,
  displayName,
  escapeMarkdown,
  formatTaskCard,
  groupTimezone,
  mdName,
  populatedUser,
  priorityLabel,
  priorityWord,
  refId,
  statusLabel,
  statusPickerText,
  statusWord,
  storeTaskCallbackData,
  truncate,
  typeLabel,
  typePickerText,
  typeWord,
} from 'src/bot/task-card.renderer';
import { Group } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import logger from 'src/shared/logger/logger';
import { configService } from 'src/configs/configuration';
import { groupMessengerService, isForumChat, topicOf } from 'src/shared/services/group-messenger.service';
import { notificationService } from 'src/shared/services/notification.service';
import { InlineKeyboardButton } from 'telegraf/types';

interface TaskCallbackData {
  taskId: string;
  action: string;
  [key: string]: unknown;
}

export async function handleTaskCallback(ctx: BotContext) {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !('data' in callbackQuery)) return;

  const data = callbackQuery.data;
  if (!data?.startsWith('task:')) return;

  const parts = data.split(':');
  if (parts.length !== 3) return;

  const [, action, storageKey] = parts;

  try {
    const cbData = await callbackDataStorageService.getCallbackData<TaskCallbackData>(ctx, storageKey, 'task_cb');

    const task = await taskService.getTaskById(cbData.taskId);
    if (!task) {
      await ctx.answerCbQuery('This task no longer exists.');
      return;
    }

    const fromUser = await userService.findUserByTelegramId(callbackQuery.from.id);
    if (!fromUser) {
      await ctx.answerCbQuery('Send any message in this group first, then try again.', { show_alert: true });
      return;
    }

    switch (action) {
      case 'status_start':
        await handleStatusChange(ctx, task, 'in_progress', fromUser);
        break;
      case 'status_done':
        await handleStatusChange(ctx, task, 'done', fromUser);
        break;
      case 'status_reopen':
        await handleStatusChange(ctx, task, 'todo', fromUser);
        break;
      case 'set_status':
        await handleStatusChange(ctx, task, String(cbData.value), fromUser);
        break;
      case 'status':
        await renderCard(ctx, task, await buildStatusPicker(task), statusPickerText());
        await ctx.answerCbQuery('Pick a status');
        break;
      case 'more':
        await renderCard(ctx, task, await buildMoreButtons(task));
        await ctx.answerCbQuery();
        break;
      case 'back':
        await updateTaskCardMessage(ctx, task);
        await ctx.answerCbQuery();
        break;
      case 'priority':
        await showKeyboard(ctx, await buildPriorityPicker(task), 'Pick a priority');
        break;
      case 'set_priority':
        await handleSetPriority(ctx, task, fromUser, String(cbData.value));
        break;
      case 'type':
        await renderCard(ctx, task, await buildTypePicker(task), typePickerText());
        await ctx.answerCbQuery('Pick a type');
        break;
      case 'set_type':
        await handleSetType(ctx, task, fromUser, String(cbData.value));
        break;
      case 'assign':
        await handleShowAssignPicker(ctx, task);
        break;
      case 'assign_to':
        await handleAssignTo(ctx, task, fromUser, String(cbData.assigneeUserId));
        break;
      case 'unassign':
        await handleUnassign(ctx, task, fromUser);
        break;
      case 'assign_cancel':
        await updateTaskCardMessage(ctx, task);
        await ctx.answerCbQuery();
        break;
      case 'delete':
        await handleDeleteRequest(ctx, task, fromUser);
        break;
      case 'delete_confirm':
        await handleDelete(ctx, task, fromUser);
        break;
      default:
        await ctx.answerCbQuery('This button is outdated. Use /list to see the latest.');
    }
  } catch (error) {
    logger.error(`Task callback error: ${error}`);
    try {
      await ctx.answerCbQuery('Something went wrong. Please try again.');
    } catch {
      // query may already be answered
    }
  }
}

async function showKeyboard(ctx: BotContext, rows: InlineKeyboardButton[][], toast?: string) {
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: rows });
  } catch (error) {
    logger.warn(`Failed to swap task keyboard: ${error}`);
  }
  await ctx.answerCbQuery(toast);
}

async function getTimezone(task: ITask): Promise<string> {
  try {
    return groupTimezone(await Group.findById(task.groupId));
  } catch {
    return groupTimezone(null);
  }
}

/**
 * Short group line (an event), threaded under the card so it's clear which task it's about.
 * Forums: goes to the "Task events" topic (where the card normally is), replying across topics if not.
 */
async function postGroupLine(ctx: BotContext, task: ITask, text: string) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const card = ctx.callbackQuery && 'message' in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
  const cardThread = topicOf(card as { is_topic_message?: boolean; message_thread_id?: number } | undefined);
  const extra = { parse_mode: 'Markdown' as const, link_preview_options: { is_disabled: true } };
  try {
    const group = await Group.findById(task.groupId).catch(() => null);
    if (!group || group.telegramGroupId !== chatId) {
      await ctx.telegram.sendMessage(chatId, text, {
        ...extra,
        ...(card ? { reply_parameters: { message_id: card.message_id, allow_sending_without_reply: true } } : {}),
      });
      return;
    }
    if (isForumChat(ctx) && !group.isForum) group.isForum = true;
    await groupMessengerService.sendEvent(ctx.telegram, group, text, {
      extra,
      // A link to the card is pointless if the card itself is gone.
      ...(card ? { source: { messageId: card.message_id, threadId: cardThread, linkFallback: false } } : {}),
      fallbackThreadId: cardThread,
    });
  } catch (error) {
    logger.warn(`Failed to post group line: ${error}`);
  }
}

function shortTitle(task: ITask): string {
  return escapeMarkdown(truncate(task.title, 60));
}

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

async function handleStatusChange(ctx: BotContext, task: ITask, newStatus: string, user: IUser) {
  if (!TASK_STATUS_ORDER.includes(newStatus as TaskStatus)) {
    await ctx.answerCbQuery('That option is outdated.');
    return;
  }

  if (task.status === newStatus) {
    await updateTaskCardMessage(ctx, task);
    await ctx.answerCbQuery(`Already ${statusWord(newStatus).toLowerCase()}`);
    return;
  }

  const updatedTask = await taskService.updateTaskStatus(task._id, newStatus, user._id);
  if (!updatedTask) {
    await ctx.answerCbQuery("Couldn't update the status. Please try again.");
    return;
  }

  await taskActivityService.record({
    taskId: task._id,
    groupId: task.groupId,
    actor: user._id,
    action: 'status',
    from: statusLabel(task.status),
    to: statusLabel(newStatus),
    via: 'bot',
  });

  await updateTaskCardMessage(ctx, updatedTask);
  await ctx.answerCbQuery(`Status: ${statusWord(newStatus)}`);

  const emoji = statusLabel(newStatus).split(' ')[0];
  await postGroupLine(
    ctx,
    updatedTask,
    `${emoji} ${mdName(user)} ${statusVerb(task.status, newStatus)} *#${updatedTask.taskNumber}* · ${shortTitle(updatedTask)}`,
  );

  const assignee = populatedUser(updatedTask.assigneeId) ?? (await findUser(updatedTask.assigneeId));
  if (assignee && assignee.telegramUserId !== user.telegramUserId) {
    await notificationService.notifyStatusChange(updatedTask, user, assignee);
  }
}

async function handleSetPriority(ctx: BotContext, task: ITask, user: IUser, value: string) {
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

async function handleSetType(ctx: BotContext, task: ITask, user: IUser, value: string) {
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

async function findUser(ref: unknown): Promise<IUser | null> {
  const id = refId(ref);
  if (!id) return null;
  try {
    return await User.findById(id);
  } catch {
    return null;
  }
}

async function handleShowAssignPicker(ctx: BotContext, task: ITask) {
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

async function handleAssignTo(ctx: BotContext, task: ITask, actingUser: IUser, assigneeUserId: string) {
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
    ? `👤 ${mdName(actingUser)} took *#${updatedTask.taskNumber}* · ${shortTitle(updatedTask)}`
    : `👤 ${mdName(actingUser)} assigned *#${updatedTask.taskNumber}* to ${mdName(assignee)}`;
  if (result === 'not_started') line += dmHint(mdName(assignee));
  await postGroupLine(ctx, updatedTask, line);

  if (previous && previous.telegramUserId !== assignee.telegramUserId) {
    await notificationService.notifyUnassigned(updatedTask, previous, actingUser);
  }
}

async function handleUnassign(ctx: BotContext, task: ITask, actingUser: IUser) {
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
    `🚫 ${mdName(actingUser)} unassigned ${mdName(previous)} from *#${updatedTask.taskNumber}*`,
  );
  await notificationService.notifyUnassigned(updatedTask, previous, actingUser);
}

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

async function handleDeleteRequest(ctx: BotContext, task: ITask, user: IUser) {
  if (!(await canDeleteTask(ctx, task, user))) {
    await ctx.answerCbQuery(DELETE_FORBIDDEN, { show_alert: true });
    return;
  }

  await renderCard(ctx, task, await buildDeleteConfirmButtons(task), deleteConfirmText(task));
  await ctx.answerCbQuery('Confirm to delete');
}

async function handleDelete(ctx: BotContext, task: ITask, user: IUser) {
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

  // Edit the card in place instead of posting a new message.
  try {
    await ctx.editMessageText(
      `🗑 *#${task.taskNumber} deleted* by ${mdName(user)}\n${shortTitle(task)}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } },
    );
  } catch (error) {
    logger.warn(`Failed to update deleted task card: ${error}`);
  }

  await ctx.answerCbQuery(`Deleted #${task.taskNumber}`);
}

/** Re-render the card text (plus an optional legend) with the given keyboard, in place. */
async function renderCard(ctx: BotContext, task: ITask, rows: InlineKeyboardButton[][], extraText?: string) {
  try {
    const creator = populatedUser(task.createdBy) ?? (await findUser(task.createdBy));
    const assignee = populatedUser(task.assigneeId) ?? (await findUser(task.assigneeId));
    const tz = await getTimezone(task);

    const card = formatTaskCard(task, creator, assignee, tz);
    await ctx.editMessageText(extraText ? `${card}\n\n${extraText}` : card, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: rows },
    });
  } catch (error) {
    // "message is not modified" is expected when nothing visible changed.
    if (!String(error).includes('message is not modified')) {
      logger.error(`Failed to update task card message: ${error}`);
    }
  }
}

async function updateTaskCardMessage(ctx: BotContext, task: ITask) {
  await renderCard(ctx, task, await buildTaskButtons(task));
}
