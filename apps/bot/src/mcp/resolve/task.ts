import mongoose from 'mongoose';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { taskService } from 'src/database/services/task.service';
import { McpToolError } from 'src/mcp/context';

/** Task #N of the group (creator / assignee / epic populated). */
export async function resolveTask(group: IGroup, taskNumber: number): Promise<ITask> {
  const task = await taskService.getTaskByNumber(group._id as mongoose.Types.ObjectId, taskNumber);
  if (!task) {
    throw new McpToolError(
      `There is no task #${taskNumber} in this group (it may have been deleted). Use list_tasks with search to find the right number.`,
    );
  }
  return task;
}
