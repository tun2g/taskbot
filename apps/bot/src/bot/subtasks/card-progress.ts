import { ITask } from 'src/database/models/task.model';
import { SubtaskProgress, subtaskService } from 'src/database/services/subtask.service';

/** Fresh subtask progress for a card, or null (a subtask never has subtasks, so it skips the query). */
export async function cardSubtaskProgress(task: Pick<ITask, '_id' | 'parentTaskId'>): Promise<SubtaskProgress | null> {
  if (task.parentTaskId) return null;
  try {
    const progress = await subtaskService.progress([String(task._id)]);
    return progress.get(String(task._id)) ?? null;
  } catch {
    return null;
  }
}
