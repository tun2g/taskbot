import { mcpChannel, McpToolError } from 'src/mcp/context';
import { requireGroup } from 'src/mcp/resolve/group';
import { stripEmoji, taskLine, taskSummary } from 'src/mcp/format/task';
import { resolveAssignee } from 'src/mcp/resolve/assignee';
import { resolveEpic } from 'src/mcp/resolve/epic';
import { resolveTask } from 'src/mcp/resolve/task';
import {
  assigneeArg,
  descriptionArg,
  dueDateArg,
  epicArg,
  priorityEnum,
  statusEnum,
  titleArg,
  typeEnum,
} from 'src/mcp/tools/schemas';
import { defineTool, groupArg, IDEMPOTENT_WRITE, taskNumberArg } from 'src/mcp/tools/types';
import { TaskChange } from 'src/shared/services/task-event-lines';
import { TaskMutationError, taskMutationService, UpdateTaskFields } from 'src/shared/services/task-mutation.service';
import { z } from 'zod';

const FIELD_WORDS: Record<TaskChange['field'], string> = {
  status: 'status',
  assignee: 'assignee',
  priority: 'priority',
  type: 'type',
  title: 'title',
  description: 'description',
  due_date: 'due date',
  epic: 'epic',
};

const value = (v: string | null) => (v ? stripEmoji(v) : 'none');

export function changeText(change: TaskChange): string {
  if (change.field === 'description') return change.to ? 'description updated' : 'description cleared';
  return `${FIELD_WORDS[change.field]}: ${value(change.from)} → ${value(change.to)}`;
}

export const updateTaskTool = defineTool({
  name: 'update_task',
  title: 'Update a task',
  description:
    'Changes fields of one task (by number). Only the fields you pass change; pass null for assignee / dueDate / epic to clear them. ' +
    'The group sees one change line and the assignee gets a DM, exactly as when someone edits it in the app.',
  inputSchema: {
    group: groupArg,
    taskNumber: taskNumberArg,
    title: titleArg.optional(),
    description: descriptionArg.nullable().optional().describe('New description; null or "" clears it.'),
    status: statusEnum.optional(),
    type: typeEnum.optional(),
    priority: priorityEnum.optional(),
    assignee: assigneeArg.nullable().optional().describe('"@username", name or "me"; null unassigns.'),
    dueDate: dueDateArg.nullable().optional().describe('YYYY-MM-DD; null clears the due date.'),
    epic: epicArg.nullable().optional().describe('Epic title or id; null takes the task out of its epic.'),
  },
  annotations: IDEMPOTENT_WRITE,
  handler: async (args, ctx) => {
    const group = await requireGroup(ctx, args.group);
    const before = await resolveTask(group, args.taskNumber);

    const data: UpdateTaskFields = {};
    if (args.title !== undefined) data.title = args.title;
    if (args.description !== undefined) data.description = args.description;
    if (args.status !== undefined) data.status = args.status;
    if (args.type !== undefined) data.type = args.type;
    if (args.priority !== undefined) data.priority = args.priority;
    if (args.dueDate !== undefined) data.dueDate = args.dueDate;
    if (args.assignee !== undefined) {
      data.assigneeId = args.assignee === null ? null : String((await resolveAssignee(ctx, group, args.assignee))._id);
    }
    if (args.epic !== undefined) {
      data.epicId = args.epic === null ? null : String((await resolveEpic(group, args.epic))._id);
    }
    if (Object.keys(data).length === 0) {
      throw new McpToolError(
        'Pass at least one field to change (title, description, status, type, priority, assignee, dueDate or epic).',
      );
    }

    let result;
    try {
      result = await taskMutationService.updateTask(before, ctx.user, data, mcpChannel(ctx));
    } catch (error) {
      if (error instanceof TaskMutationError) throw new McpToolError(error.message);
      throw error;
    }

    const summary = taskSummary(result.task);
    const changes = result.changes.map(changeText);
    const text = changes.length
      ? [`Updated #${summary.number} ${summary.title}:`, ...changes.map((c) => `- ${c}`), '', taskLine(summary)].join(
          '\n',
        )
      : `Nothing changed — #${summary.number} already has those values.\n${taskLine(summary)}`;
    return { text, data: { task: summary, changes } };
  },
});
