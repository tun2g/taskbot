import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { subtaskService } from 'src/database/services/subtask.service';
import logger from 'src/shared/logger/logger';
import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import { epicLabel, epicOf, shorten } from 'src/shared/services/ai-command/format';
import { TaskRef } from 'src/shared/services/ai-command/plan.schema';
import type { TaskChange } from 'src/shared/services/task-event-lines';
import { MutationChannel, refId, TaskMutationError } from 'src/shared/services/task-mutation/common';

// The mutation service and task-sync load the bot, which loads /ai → this file: import lazily.

const mutation = () => import('src/shared/services/task-mutation.service').then((m) => m.taskMutationService);
const sync = () => import('src/shared/services/task-sync.service').then((m) => m.taskSyncService);

// The `parent` change of update_task and the epic of subtasks, through the task mutation service.

const channelOf = (c: AiRequestContext): MutationChannel => ({ activity: c.activityVia ?? 'ai' });
export const parentNumber = (ref: unknown): number | null =>
  ref && typeof ref === 'object' && 'taskNumber' in (ref as object) ? (ref as { taskNumber: number }).taskNumber : null;

/** Change lines for the parent / epic part of a mutation-service update ("↳ Subtask of #42 …"). */
function parentLines(changes: TaskChange[], task: ITask): string[] {
  const lines: string[] = [];
  for (const change of changes) {
    if (change.field === 'parent') {
      if (change.to) {
        lines.push(`↳ Subtask of ${shorten(change.to)}`);
      } else {
        // Detaching keeps the epic it had as a subtask — say so, it may need changing.
        const epic = epicOf(task.epicId);
        const kept = epic ? ` — stays in ${epicLabel(epic)}` : '';
        lines.push(`↳ No longer a subtask (was ${shorten(change.from)})${kept}`);
      }
    } else if (change.field === 'epic') {
      const to = change.to ? `${change.toIcon ? `${change.toIcon} ` : ''}${change.to}` : 'none';
      lines.push(`Epic → ${to} (same as its parent)`);
    }
  }
  return lines;
}

export interface ParentChangeResult {
  task: ITask;
  changes: string[];
  notes: string[];
  fieldChanges: TaskChange[];
}

/**
 * update_task `parent`: #N makes the task a subtask of #N (it moves into #N's epic); null turns it back into a
 * regular task. A number must be one the user wrote (same rule as task targets). Broken rules become notes.
 */
export async function applyParentChange(
  c: AiRequestContext,
  task: ITask,
  parent: number | null,
  resolveTarget: (ref: TaskRef) => Promise<{ task: ITask } | { miss: unknown }>,
): Promise<ParentChangeResult> {
  const none: ParentChangeResult = { task, changes: [], notes: [], fieldChanges: [] };
  const currentNumber = parentNumber(task.parentTaskId);

  let parentTaskId: string | null = null;
  if (parent === null) {
    if (!task.parentTaskId) return { ...none, notes: ['ℹ️ Not a subtask.'] };
  } else {
    if (parent === currentNumber) return { ...none, notes: [`ℹ️ Already a subtask of #${parent}.`] };
    const target = await resolveTarget(parent);
    if ('miss' in target) return { ...none, notes: [`⚠️ There's no task #${parent} to put it under.`] };
    parentTaskId = String(target.task._id);
  }

  try {
    const result = await (await mutation()).updateTask(task, c.requester, { parentTaskId }, channelOf(c));
    return {
      task: result.task,
      changes: parentLines(result.changes, result.task),
      notes: [],
      fieldChanges: result.changes,
    };
  } catch (error) {
    if (error instanceof TaskMutationError) return { ...none, notes: [`⚠️ ${error.message}`] };
    throw error;
  }
}

/** A subtask's epic follows its parent: the note shown instead of changing it. */
export function subtaskEpicNote(task: ITask): string {
  const n = parentNumber(task.parentTaskId);
  return `⚠️ #${task.taskNumber} is a subtask, so it stays in its parent's epic.${n ? ` Change the epic on #${n} instead.` : ''}`;
}

/** After a task's epic changed: its subtasks follow (and their cards refresh). Never throws. */
export async function moveSubtasksToEpic(task: ITask, epicId: unknown): Promise<void> {
  try {
    const id = refId(epicId);
    const moved = await subtaskService.setEpic(
      task._id as mongoose.Types.ObjectId,
      id ? new mongoose.Types.ObjectId(id) : null,
    );
    if (moved > 0) {
      const taskSyncService = await sync();
      for (const child of await subtaskService.list(task._id as mongoose.Types.ObjectId)) {
        taskSyncService.syncTaskCard(child).catch(() => undefined);
      }
    }
  } catch (error) {
    logger.warn(`Could not move the subtasks of #${task.taskNumber} with its epic: ${error}`);
  }
}
