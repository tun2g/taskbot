import { TASK_STATUS_ORDER, TaskStatus } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { closeAnywayDmRows, closeAnywayText, openSubtasksBlockingClose } from 'src/bot/subtasks/close-guard';
import { PRIMARY_ACTION, statusWord } from 'src/bot/task-card.renderer';
import { Group } from 'src/database/models/group.model';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { DM_CLOSE_ACTION, DM_EXPLAIN_ACTION, dmTaskKeyboard } from 'src/shared/services/notification.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';
import { groupUnavailableToast, isGroupActive } from 'src/shared/utils/group-status';
import { InlineKeyboardButton } from 'telegraf/types';
import { handleExplain } from './explain';
import { postGroupLineFor } from './group-line';
import { canChangeFromDm } from './membership';
import { applyStatusChange, notifyAssigneeOfStatus, statusLine } from './status';

// ── DM quick actions ("▶ Start" / "✅ Done" under a DM) ──

/** Swap only the DM's buttons; the DM text stays as it was. */
async function setDmButtons(ctx: BotContext, rows: InlineKeyboardButton[][]) {
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: rows });
  } catch (error) {
    if (!String(error).includes('message is not modified')) logger.warn(`Failed to update DM buttons: ${error}`);
  }
}

/**
 * `tdm:<status>:<taskId>` from a DM. Self-contained (no Redis), so a reminder tapped the next
 * day still works. Same service path as the group card; the card refreshes via the sync and the
 * event line goes to the group, never to the DM.
 */
export async function handleDmTaskCallback(ctx: BotContext, data: string) {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery) return;
  const [, to, taskId] = data.split(':');

  try {
    if (to === 'noop') {
      await ctx.answerCbQuery('This task is closed. Open it to reopen.');
      return;
    }
    if (to === DM_EXPLAIN_ACTION) {
      const task = taskId ? await taskService.getTaskById(taskId) : null;
      if (!task) {
        await ctx.answerCbQuery('This task no longer exists.');
        return;
      }
      const user = await userService.findUserByTelegramId(callbackQuery.from.id);
      if (!user) {
        await ctx.answerCbQuery('Send any message in the task’s group first, then try again.', { show_alert: true });
        return;
      }
      await handleExplain(ctx, task, user, { onCard: false });
      return;
    }

    const task = taskId ? await taskService.getTaskById(taskId) : null;
    if (!task) {
      await setDmButtons(ctx, []);
      await ctx.answerCbQuery('This task no longer exists.');
      return;
    }
    // "✅ Done #N" (all subtasks done / "Yes, close" after the open-subtasks question): close from any status.
    const forced = to === DM_CLOSE_ACTION;
    const target = forced ? TaskStatus.DONE : to;
    if (!TASK_STATUS_ORDER.includes(target as TaskStatus)) {
      await setDmButtons(ctx, dmTaskKeyboard(task));
      await ctx.answerCbQuery('That button is outdated.');
      return;
    }

    const user = await userService.findUserByTelegramId(callbackQuery.from.id);
    const group = await Group.findById(task.groupId).catch(() => null);
    if (!user || !group || !(await canChangeFromDm(ctx.telegram, group, task, user))) {
      await ctx.answerCbQuery("You can't change this task — you're not in its group anymore.", { show_alert: true });
      return;
    }
    // DM buttons skip the group gate: a paused / unapproved group's tasks stay as they are until it is active.
    if (!isGroupActive(group)) {
      await ctx.answerCbQuery(groupUnavailableToast(group, { named: true }), { show_alert: true });
      return;
    }

    if (task.status === target) {
      await setDmButtons(ctx, dmTaskKeyboard(task));
      await ctx.answerCbQuery(`#${task.taskNumber} is already ${statusWord(target).toLowerCase()}`);
      return;
    }
    // Someone moved it meanwhile: don't apply a stale step, show the current next step instead.
    if (!forced && (PRIMARY_ACTION[task.status] || PRIMARY_ACTION.todo).to !== target) {
      await setDmButtons(ctx, dmTaskKeyboard(task));
      await ctx.answerCbQuery(`#${task.taskNumber} is ${statusWord(task.status).toLowerCase()} now — buttons updated`);
      return;
    }
    const openSubtasks = forced ? 0 : await openSubtasksBlockingClose(task, target);
    if (openSubtasks > 0) {
      await setDmButtons(ctx, closeAnywayDmRows(task, target));
      await ctx.answerCbQuery(closeAnywayText(task.taskNumber, openSubtasks, target).replace(/\*/g, ''), {
        show_alert: true,
      });
      return;
    }

    const updatedTask = await applyStatusChange(task, target, user);
    if (!updatedTask) {
      await ctx.answerCbQuery("Couldn't update the status. Please try again.");
      return;
    }

    await setDmButtons(ctx, dmTaskKeyboard(updatedTask));
    await ctx.answerCbQuery(`#${updatedTask.taskNumber}: ${statusWord(target)}`);

    await taskSyncService.syncTaskCard(updatedTask);
    await postGroupLineFor(ctx.telegram, group, updatedTask, statusLine(user, task.status, updatedTask));
    await notifyAssigneeOfStatus(updatedTask, user);
  } catch (error) {
    logger.error(`DM task callback error: ${error}`);
    try {
      await ctx.answerCbQuery('Something went wrong. Please try again.');
    } catch {
      // query may already be answered
    }
  }
}
