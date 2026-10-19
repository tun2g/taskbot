import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';

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
