import { randomBytes } from 'crypto';
import { IGroup } from 'src/database/models/group.model';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import { McpContext, mcpChannel, McpToolError } from 'src/mcp/context';
import { requireGroup } from 'src/mcp/resolve/group';
import { taskLine, taskSummary } from 'src/mcp/format/task';
import { resolveAssignee } from 'src/mcp/resolve/assignee';
import { resolveEpic } from 'src/mcp/resolve/epic';
import {
  assigneeArg,
  descriptionArg,
  dueDateArg,
  epicArg,
  priorityEnum,
  titleArg,
  typeEnum,
} from 'src/mcp/tools/schemas';
import { ADDITIVE, defineTool, groupArg } from 'src/mcp/tools/types';
import logger from 'src/shared/logger/logger';
import { rememberAppBatchPost } from 'src/shared/services/ai-command/web-chat';
import { BATCH_UNDO_WINDOW_MS, CreatedTask } from 'src/shared/services/task-creation.service';
import { CreateTaskFields, taskMutationService } from 'src/shared/services/task-mutation.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';
import { z } from 'zod';

export const CREATE_TASKS_MAX = 20;

const newTask = z.object({
  title: titleArg,
  description: descriptionArg.optional(),
  type: typeEnum.optional(),
  priority: priorityEnum.optional(),
  assignee: assigneeArg.optional(),
  dueDate: dueDateArg.optional(),
  epic: epicArg.optional(),
});
type NewTask = z.infer<typeof newTask>;

/** Validates every task (assignee, epic) before creating any, so a typo never leaves half a batch behind. */
async function resolveAll(ctx: McpContext, group: IGroup, tasks: NewTask[]): Promise<CreateTaskFields[]> {
  const fields: CreateTaskFields[] = [];
  for (const [index, t] of tasks.entries()) {
    const where = tasks.length > 1 ? `tasks[${index}] ("${t.title}"): ` : '';
    try {
      const assignee = t.assignee ? await resolveAssignee(ctx, group, t.assignee) : null;
      const epic = t.epic ? await resolveEpic(group, t.epic) : null;
      fields.push({
        title: t.title,
        ...(t.description ? { description: t.description } : {}),
        ...(t.type ? { type: t.type } : {}),
        ...(t.priority ? { priority: t.priority } : {}),
        ...(assignee ? { assigneeId: String(assignee._id) } : {}),
        ...(t.dueDate ? { dueDate: t.dueDate } : {}),
        ...(epic ? { epicId: String(epic._id) } : {}),
      });
    } catch (error) {
      if (error instanceof McpToolError) throw new McpToolError(`${where}${error.message} Nothing was created.`);
      throw error;
    }
  }
  return fields;
}

export const createTasksTool = defineTool({
  name: 'create_tasks',
  title: 'Create tasks',
  description:
    `Creates 1–${CREATE_TASKS_MAX} tasks in a group. Each title should be a clean work item. ` +
    'The group sees one message (a task card for one task, a summary for several), the assignee gets a DM. ' +
    'Returns the new task numbers and an undoToken for undo_last (10 minutes).',
  inputSchema: {
    group: groupArg,
    tasks: z
      .array(newTask)
      .min(1, 'Pass at least one task.')
      .max(CREATE_TASKS_MAX, `At most ${CREATE_TASKS_MAX} tasks per call.`),
  },
  annotations: ADDITIVE,
  handler: async ({ group: groupRef, tasks }, ctx) => {
    const group = await requireGroup(ctx, groupRef);
    const fields = await resolveAll(ctx, group, tasks);

    const batchId = randomBytes(8).toString('hex');
    const channel = mcpChannel(ctx);
    const created: CreatedTask[] = [];
    const failed: string[] = [];
    for (const f of fields) {
      try {
        const result = await taskMutationService.createTask(group, ctx.user, f, { channel, announce: 'none', batchId });
        // The card / summary shows the epic from the populated ref.
        if (f.epicId && typeof result.task.populate === 'function') await result.task.populate(TASK_POPULATE);
        created.push(result);
      } catch (error) {
        logger.error(`MCP create_tasks: could not create "${f.title}": ${error}`);
        failed.push(f.title);
      }
    }
    if (created.length === 0) throw new McpToolError('No task could be saved. Please try again in a moment.');

    // ONE group message: the card for a single task, a summary for several.
    const post = await taskSyncService.postCreatedFromApp(group, ctx.user, created, ctx.clientLabel);
    if (post) await rememberAppBatchPost(batchId, post);

    const items = created.map(({ task }) => taskSummary(task));
    const undoUntil = new Date(Date.now() + BATCH_UNDO_WINDOW_MS).toISOString();
    const lines = [
      `Created ${items.length} task${items.length === 1 ? '' : 's'} in ${group.groupName}:`,
      ...items.map((t) => `- ${taskLine(t)}`),
    ];
    if (failed.length) lines.push(`Could not save: ${failed.map((t) => `"${t}"`).join(', ')} — try them again.`);
    lines.push(`Undo within 10 minutes: undo_last with undoToken "${batchId}".`);

    return {
      text: lines.join('\n'),
      data: { tasks: items, undoToken: batchId, undoUntil, ...(failed.length ? { failed } : {}) },
    };
  },
});
