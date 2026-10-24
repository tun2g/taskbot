import { bot } from 'src/bot';
import { notifyIfAllSubtasksDone } from 'src/bot/subtasks/all-done';
import { cardSubtaskProgress } from 'src/bot/subtasks/card-progress';
import { buildTaskButtons, formatTaskCard } from 'src/bot/task-card.renderer';
import { ITask, Task } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import logger from 'src/shared/logger/logger';
import { escapeLegacyMarkdown } from 'src/shared/services/task-creation.service';
import { postTaskEvent } from './post-event';

function isUserDoc(value: unknown): value is IUser {
  return !!value && typeof value === 'object' && 'telegramUserId' in (value as object);
}

/**
 * Refresh the task card in the group chat.
 * - Card exists → edit it in place.
 * - No card → post one ONLY when `created` is set (task just created from the app).
 *   AI batch tasks have no card on purpose, so an update must never spawn one.
 * `via` ("app", "Claude Code"…) adds "(via …)" under a newly posted card, like the cards of app/MCP batches.
 */
export async function syncTaskCard(task: ITask, options: { created?: boolean; via?: string } = {}) {
  try {
    const fullTask = await Task.findById(task._id).populate(TASK_POPULATE);
    if (!fullTask) return;

    const creator = isUserDoc(fullTask.createdBy) ? fullTask.createdBy : null;
    const assignee = isUserDoc(fullTask.assigneeId) ? fullTask.assigneeId : null;

    const progress = await cardSubtaskProgress(fullTask);
    notifyIfAllSubtasksDone(fullTask, progress).catch(() => {});
    const text = formatTaskCard(fullTask, creator, assignee, undefined, progress);
    const buttons = await buildTaskButtons(fullTask);

    if (fullTask.taskCardMessageId && fullTask.taskCardChatId) {
      try {
        await bot.telegram.editMessageText(fullTask.taskCardChatId, fullTask.taskCardMessageId, undefined, text, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (!errMsg.includes('message is not modified')) {
          logger.warn(`Could not edit task card for task ${fullTask._id}: ${errMsg}`);
        }
      }
      return;
    }

    if (options.created && fullTask.taskCardChatId) {
      const body = options.via ? `${text}\n\n_(via ${escapeLegacyMarkdown(options.via)})_` : text;
      const newMsg = await postTaskEvent(fullTask.groupId, fullTask.taskCardChatId, body, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      });
      await Task.findByIdAndUpdate(fullTask._id, { $set: { taskCardMessageId: newMsg.message_id } });
    }
  } catch (error) {
    logger.error(`Task sync error: ${error}`);
  }
}
