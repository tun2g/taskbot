import { buildTaskButtons, formatTaskCard, groupTimezone } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import type { AiRequestContext } from 'src/shared/services/ai-command/context';
import { CardEditor } from 'src/shared/services/ai-command/result';
import { notificationService } from 'src/shared/services/notification.service';

/** DMs about an AI change: the new assignee, the previous one and (on a status change) the assignee. */

export async function notifyChange(
  c: AiRequestContext,
  task: ITask,
  previousAssignee: IUser | null,
  newAssignee: IUser | null | undefined,
  statusChanged: boolean,
) {
  try {
    if (newAssignee) await notificationService.notifyAssignment(task, newAssignee, c.requester);
    if (newAssignee !== undefined && previousAssignee) {
      await notificationService.notifyUnassigned(task, previousAssignee, c.requester);
    }
    // A fresh assignee already got the assignment DM (which shows the task); others hear about the status.
    const assignee = newAssignee === undefined ? previousAssignee : null;
    if (statusChanged && assignee) await notificationService.notifyStatusChange(task, c.requester, assignee);
  } catch (error) {
    logger.warn(`AI command notification failed for task ${task._id}: ${error}`);
  }
}

/** Edit the original task card so it shows the new state. */
export async function refreshCard(c: AiRequestContext, task: ITask, editor: CardEditor) {
  if (!task.taskCardChatId || !task.taskCardMessageId) return;
  try {
    const text = formatTaskCard(task, undefined, undefined, groupTimezone(c.group));
    const buttons = await buildTaskButtons(task);
    await editor.editMessageText(task.taskCardChatId, task.taskCardMessageId, undefined, text, {
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
