import { BotContext } from 'src/bot/interface/context';
import { handleShowSubtasks } from 'src/bot/subtasks/subtask-list-view';
import {
  buildMoreButtons,
  buildPriorityPicker,
  buildStatusPicker,
  buildTypePicker,
  statusPickerText,
  typePickerText,
} from 'src/bot/task-card.renderer';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { DM_TASK_CALLBACK_PREFIX } from 'src/shared/services/notification.service';
import { handleAssignTo, handleShowAssignPicker, handleUnassign } from './assign';
import { renderCard, showKeyboard, updateTaskCardMessage } from './card';
import { handleDelete, handleDeleteRequest } from './delete';
import { handleDmTaskCallback } from './dm';
import { handleExplain } from './explain';
import { handleSetPriority, handleSetType } from './fields';
import { handleStatusChange } from './status';

interface TaskCallbackData {
  taskId: string;
  action: string;
  [key: string]: unknown;
}

export async function handleTaskCallback(ctx: BotContext) {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !('data' in callbackQuery)) return;

  const data = callbackQuery.data;
  if (data?.startsWith(DM_TASK_CALLBACK_PREFIX)) {
    await handleDmTaskCallback(ctx, data);
    return;
  }
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
        await handleStatusChange(ctx, task, String(cbData.value), fromUser, cbData.force === true);
        break;
      case 'subtasks':
        await handleShowSubtasks(ctx, task, (rows, text) => renderCard(ctx, task, rows, text));
        break;
      case 'close_anyway': {
        const { doneCommand } = await import('src/bot/commands/done');
        await doneCommand.confirmClose(ctx, task, fromUser);
        break;
      }
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
      case 'explain':
        // Back to the card's main buttons; the explanation arrives threaded under the card.
        await updateTaskCardMessage(ctx, task);
        await handleExplain(ctx, task, fromUser, { onCard: true });
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
