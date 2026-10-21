import { mcpChannel, McpToolError } from 'src/mcp/context';
import { requireGroup } from 'src/mcp/resolve/group';
import { resolveTask } from 'src/mcp/resolve/task';
import { defineTool, groupArg, taskNumberArg } from 'src/mcp/tools/types';
import { TaskMutationError, taskMutationService } from 'src/shared/services/task-mutation.service';

export const deleteTaskTool = defineTool({
  name: 'delete_task',
  title: 'Delete a task',
  description:
    'Permanently deletes one task (by number). Only its creator or a Telegram admin of the group may delete. ' +
    'Its subtasks are kept and become regular tasks. ' +
    'This cannot be undone — prefer status "cancelled" unless the user explicitly asked to delete.',
  inputSchema: { group: groupArg, taskNumber: taskNumberArg },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ group: groupRef, taskNumber }, ctx) => {
    const group = await requireGroup(ctx, groupRef);
    const task = await resolveTask(group, taskNumber);
    let detached: { taskNumber: number }[] = [];
    try {
      ({ detached } = await taskMutationService.deleteTask(task, ctx.user, { group, channel: mcpChannel(ctx) }));
    } catch (error) {
      if (error instanceof TaskMutationError) {
        throw new McpToolError(
          error.code === 'forbidden'
            ? `${error.message} You can set its status to "cancelled" with update_task instead.`
            : error.message,
        );
      }
      throw error;
    }
    const kept = detached.map((t) => `#${t.taskNumber}`);
    const keptText = kept.length
      ? ` Its subtask${kept.length === 1 ? '' : 's'} ${kept.join(', ')} ${kept.length === 1 ? 'is' : 'are'} kept as regular tasks.`
      : '';
    return {
      text: `Deleted #${task.taskNumber} ${task.title}.${keptText}`,
      data: { deleted: true, number: task.taskNumber, title: task.title, keptSubtasks: detached.map((t) => t.taskNumber) },
    };
  },
});
