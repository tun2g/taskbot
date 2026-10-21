import { ITask, Task } from 'src/database/models/task.model';
import { ParentRefLike, populatedParent } from 'src/bot/subtasks/subtask-lines';

/** The task's parent as `{ taskNumber, title }` — the populated ref, or loaded by id; null for a regular task. */
export async function resolveParentRef(task: Pick<ITask, 'parentTaskId'>): Promise<ParentRefLike | null> {
  const ref = task.parentTaskId;
  if (!ref) return null;
  const populated = populatedParent(ref);
  if (populated) return populated;
  try {
    const parent = await Task.findById(ref).select('taskNumber title');
    return parent ? { taskNumber: parent.taskNumber, title: parent.title } : null;
  } catch {
    return null;
  }
}
