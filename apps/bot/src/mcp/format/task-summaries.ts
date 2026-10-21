import { ITask } from 'src/database/models/task.model';
import { subtaskService } from 'src/database/services/subtask.service';
import { TaskSummary, taskSummary } from 'src/mcp/format/task';

/** Summaries with subtask progress, counted in one query for the whole list. */
export async function summarizeTasks(tasks: ITask[]): Promise<TaskSummary[]> {
  const progress = await subtaskService.progress(tasks.map((t) => String(t._id)));
  return tasks.map((t) => taskSummary(t, progress.get(String(t._id)) ?? null));
}

export async function summarizeTask(task: ITask): Promise<TaskSummary> {
  return (await summarizeTasks([task]))[0];
}
