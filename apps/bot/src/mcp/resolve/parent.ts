import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { McpToolError } from 'src/mcp/context';
import { parentNumberOf } from 'src/mcp/format/task';
import { resolveTask } from 'src/mcp/resolve/task';

/**
 * Task #N as a parent for a new / moved subtask. Catches the common mistake (nesting under a subtask) with a
 * pointer to the right parent; the mutation service enforces the remaining rules (max subtasks, self-parent…).
 */
export async function resolveParentTask(group: IGroup, taskNumber: number): Promise<ITask> {
  const parent = await resolveTask(group, taskNumber);
  if (parent.parentTaskId) {
    const top = parentNumberOf(parent.parentTaskId);
    throw new McpToolError(
      `#${taskNumber} is itself a subtask${top ? ` of #${top}` : ''}, and subtasks are only one level deep.` +
        (top ? ` Use parent ${top} instead.` : ''),
    );
  }
  return parent;
}
