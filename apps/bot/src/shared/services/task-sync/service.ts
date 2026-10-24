import mongoose from 'mongoose';
import { bot } from 'src/bot';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import { UndoneTask } from 'src/shared/services/batch-undo.service';
import type { CreatedTask } from 'src/shared/services/task-creation.service';
import { buildChangeLine, buildDeleteLine, TaskChange, userDisplayName } from 'src/shared/services/task-event-lines';
import { taskButton } from 'src/shared/utils/app-links';
import { markBatchUndone, postCreatedFromApp } from './app-batch';
import { syncTaskCard } from './card';
import { postTaskEvent } from './post-event';

export class TaskSyncService {
  /** Refresh the task card in the group chat (see `syncTaskCard` in ./card). */
  async syncTaskCard(task: ITask, options: { created?: boolean; via?: string } = {}) {
    return syncTaskCard(task, options);
  }

  /**
   * Post one combined line about an app PATCH (only for status / assignee / title changes).
   * `via` is the channel in "(via …)" — "app" by default, or the MCP client ("Claude Code").
   */
  async postChangeSummary(
    task: ITask,
    actorUserId: mongoose.Types.ObjectId | string,
    changes: TaskChange[],
    via = 'app',
  ) {
    try {
      const actor = await User.findById(actorUserId);
      const line = buildChangeLine(userDisplayName(actor), task.taskNumber, task.title, changes, via);
      if (!line) return;

      // One tap from the group line to the task itself (no hunting on the board).
      const open = taskButton(task);
      await postTaskEvent(task.groupId, task.taskCardChatId, line, {
        parse_mode: 'HTML',
        ...(open ? { reply_markup: { inline_keyboard: [[open]] } } : {}),
      });
    } catch (error) {
      logger.error(`Change summary error for task ${task._id}: ${error}`);
    }
  }

  /** After a delete from the app: remove the card (best effort) and tell the group. */
  async onTaskDeleted(task: ITask, actorUserId: mongoose.Types.ObjectId | string, via = 'app') {
    try {
      if (task.taskCardChatId && task.taskCardMessageId) {
        await bot.telegram.deleteMessage(task.taskCardChatId, task.taskCardMessageId).catch(() => {});
      }

      const actor = await User.findById(actorUserId);
      await postTaskEvent(task.groupId, task.taskCardChatId, buildDeleteLine(userDisplayName(actor), task.taskNumber, task.title, via), {
        parse_mode: 'HTML',
      });
    } catch (error) {
      logger.error(`Delete notification error for task ${task._id}: ${error}`);
    }
  }

  /** Tasks created from the web chat: ONE group message (see `postCreatedFromApp` in ./app-batch). */
  async postCreatedFromApp(
    group: IGroup,
    requester: IUser,
    created: CreatedTask[],
    via = 'app',
  ): Promise<{ chatId: number; messageId: number } | null> {
    return postCreatedFromApp(group, requester, created, via);
  }

  /** After an undo from the web chat: rewrite the group post (see `markBatchUndone` in ./app-batch). */
  async markBatchUndone(
    post: { chatId: number; messageId: number },
    actorName: string,
    removed: number,
    tasks: UndoneTask[] = [],
    groupId?: IGroup['_id'] | string,
    via = 'app',
  ) {
    return markBatchUndone(post, actorName, removed, tasks, groupId, via);
  }
}

export const taskSyncService = new TaskSyncService();
