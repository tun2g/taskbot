import { randomBytes } from 'crypto';
import { IGroup } from 'src/database/models/group.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import logger from 'src/shared/logger/logger';
import { personName, shorten } from 'src/shared/services/ai-command/format';
import { SubtasksOutcome } from 'src/shared/services/ai-command/result';
import { BATCH_CALLBACK_PREFIX, BatchCallbackData } from 'src/shared/services/batch-undo.constants';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { TaskMutationError } from 'src/shared/services/task-mutation/common';

// Creating a list of subtasks under one parent (from /ai, the web chat, or an accepted AI preview):
// one batch (undo), one rule message when the parent fills up, a Telegram ↩️ Undo key.

// The mutation service loads the bot, which loads /ai → this file: import lazily.
const mutation = () => import('src/shared/services/task-mutation.service').then((m) => m.taskMutationService);

/** A subtask ready to create: people already resolved to members. */
export interface ReadyItem {
  title: string;
  assignee: IUser | null;
  dueDate?: string | null;
}

/** Who creates the subtasks, where, and through which channel. */
export interface SubtaskCreateContext {
  group: IGroup;
  requester: IUser;
  activityVia: TaskActivityVia;
  /** 'telegram' stores an ↩️ Undo key; the web chat undoes by batch id. */
  channel: 'telegram' | 'web';
}

/** Telegram: stores the batch for the ↩️ Undo button (same handler as /task batches). */
async function rememberUndo(c: SubtaskCreateContext, batchId: string, count: number): Promise<string | undefined> {
  const key = randomBytes(6).toString('hex');
  const data: BatchCallbackData = {
    batchId,
    groupId: c.group._id.toString(),
    chatId: c.group.telegramGroupId,
    requesterTelegramId: c.requester.telegramUserId,
    requesterName: personName(c.requester),
    count,
    createdAt: Date.now(),
  };
  try {
    await callbackDataStorageService.setCallbackData(key, BATCH_CALLBACK_PREFIX, data);
    return key;
  } catch (error) {
    logger.warn(`Could not store undo for subtask batch ${batchId}: ${error}`);
    return undefined;
  }
}

/**
 * Creates `items` under `parent` in one batch, stopping at the first broken rule (e.g. the parent just became
 * full) with its message as a warning. `warnings` already collected are kept in front.
 */
export async function createSubtaskItems(
  c: SubtaskCreateContext,
  parent: ITask,
  items: ReadyItem[],
  opts: { proposed: boolean; warnings?: string[] },
): Promise<SubtasksOutcome> {
  const warnings = [...(opts.warnings ?? [])];
  const batchId = randomBytes(8).toString('hex');
  const taskMutationService = await mutation();
  const created: SubtasksOutcome['created'] = [];
  for (const item of items) {
    try {
      const result = await taskMutationService.createTask(
        c.group,
        c.requester,
        {
          title: item.title,
          parentTaskId: String(parent._id),
          ...(item.assignee ? { assigneeId: String(item.assignee._id) } : {}),
          ...(item.dueDate ? { dueDate: item.dueDate } : {}),
        },
        { channel: { activity: c.activityVia }, announce: 'none', batchId },
      );
      // Group posts show the epic and "↳ #42" from the populated refs.
      if (typeof result.task.populate === 'function') await result.task.populate(TASK_POPULATE);
      created.push(result);
    } catch (error) {
      if (error instanceof TaskMutationError) {
        warnings.push(`⚠️ ${error.message}`);
        break;
      }
      logger.error(`AI subtasks: could not create "${item.title}" under #${parent.taskNumber}: ${error}`);
      warnings.push(`⚠️ Couldn't save “${shorten(item.title, 40)}”. Please add it again.`);
    }
  }

  if (created.length === 0) return { parent, created, proposed: opts.proposed, warnings, batchId: null };
  const undoKey = c.channel === 'web' ? undefined : await rememberUndo(c, batchId, created.length);
  return { parent, created, proposed: opts.proposed, warnings, batchId, ...(undoKey ? { undoKey } : {}) };
}
