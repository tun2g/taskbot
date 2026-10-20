import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { escapeHtml, shorten, typeIcon } from 'src/shared/services/ai-command/format';

/**
 * Removes every task of an AI-created batch in one group and logs a `deleted` activity for each.
 * Shared by the ↩️ Undo button (Telegram) and POST /api/batches/:batchId/undo (web chat).
 * Permission and the 10-minute window are checked by the caller.
 */
export async function undoBatch(params: {
  batchId: string;
  groupId: string;
  actor: mongoose.Types.ObjectId | null;
  via: 'bot' | 'app';
  /** Tasks already loaded by the caller (avoids a second query). */
  tasks?: ITask[];
}): Promise<{ removed: number; tasks: ITask[] }> {
  const all = params.tasks ?? (await taskService.getTasksByBatch(params.batchId));
  const tasks = all.filter((t) => t.groupId.toString() === params.groupId);
  const removed = tasks.length ? await taskService.deleteTasks(tasks.map((t) => t._id)) : 0;
  for (const task of tasks) {
    await taskActivityService.record({
      taskId: task._id,
      groupId: task.groupId,
      actor: params.actor,
      action: 'deleted',
      from: task.title,
      via: params.via,
    });
  }
  return { removed, tasks };
}

export type UndoneTask = Pick<ITask, 'taskNumber' | 'title' | 'type'>;

/**
 * HTML for a batch summary after ↩️ Undo (Telegram button and web chat): who undid it and which
 * tasks went away (struck through), so the message still says what happened. `removed === 0`
 * means someone else had already deleted them.
 */
export function buildUndoneText(params: {
  actorName: string;
  removed: number;
  tasks: UndoneTask[];
  viaApp?: boolean;
}): string {
  const { actorName, removed, tasks } = params;
  const by = `${escapeHtml(actorName)}${params.viaApp ? ' (via app)' : ''}`;
  if (removed === 0) {
    return `↩️ <b>Undo by ${by}</b> · nothing to remove — these tasks were already deleted.`;
  }
  const lines = [`↩️ <b>Undone by ${by}</b> · ${removed} task${removed === 1 ? '' : 's'} removed`];
  if (tasks.length) {
    lines.push('', ...tasks.map((t) => `<s>#${t.taskNumber} ${typeIcon(t.type)} ${escapeHtml(shorten(t.title))}</s>`));
  }
  return lines.join('\n');
}
