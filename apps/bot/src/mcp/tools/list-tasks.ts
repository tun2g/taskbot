import mongoose from 'mongoose';
import { resolveDueFilter, resolveStatusFilter } from 'src/api/controllers/task.controller';
import { resolveGroupTimezone } from 'src/api/timezone';
import { TaskDueFilter } from 'src/api/validation';
import { IGroup } from 'src/database/models/group.model';
import { TaskFilters, taskService } from 'src/database/services/task.service';
import { McpContext } from 'src/mcp/context';
import { requireGroup } from 'src/mcp/resolve/group';
import { taskLine } from 'src/mcp/format/task';
import { summarizeTasks } from 'src/mcp/format/task-summaries';
import { resolveAssignee } from 'src/mcp/resolve/assignee';
import { resolveEpic } from 'src/mcp/resolve/epic';
import { resolveTask } from 'src/mcp/resolve/task';
import { categoryEnum, priorityEnum, statusEnum, typeEnum } from 'src/mcp/tools/schemas';
import { defineTool, groupArg, READ_ONLY } from 'src/mcp/tools/types';
import { z } from 'zod';

export const LIST_TASKS_MAX = 50;
const DEFAULT_LIMIT = 20;

const inputSchema = {
  group: groupArg,
  status: statusEnum.optional().describe('Only this status.'),
  category: categoryEnum.optional(),
  includeClosed: z
    .boolean()
    .optional()
    .describe('Without status/category only open tasks are listed; set true to include done and cancelled ones.'),
  assignee: z.string().trim().min(1).optional().describe('"me", "none" (unassigned), or a member\'s @username / name.'),
  epic: z.string().trim().min(1).optional().describe('Epic title or id, or "none" for tasks without an epic.'),
  parent: z
    .union([z.number().int().positive(), z.literal('none')])
    .optional()
    .describe('A task number → only its subtasks (all statuses unless you filter); "none" → only top-level tasks (hides subtasks).'),
  type: typeEnum.optional(),
  priority: priorityEnum.optional(),
  due: z
    .enum(['overdue', 'today', 'week', 'none'])
    .optional()
    .describe('overdue, today, week (next 7 days) or none (no due date).'),
  search: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Words in the title/description, or a task number like "#12".'),
  page: z.number().int().positive().optional().describe('Page number, from 1.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIST_TASKS_MAX)
    .optional()
    .describe(`Tasks per page (default ${DEFAULT_LIMIT}, max ${LIST_TASKS_MAX}).`),
};

type ListArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** The tool's filters → the same TaskFilters the board's list endpoint uses. */
export async function buildFilters(ctx: McpContext, group: IGroup, args: ListArgs): Promise<TaskFilters> {
  const filters: TaskFilters = {
    page: args.page ?? 1,
    limit: args.limit ?? DEFAULT_LIMIT,
    ...(args.type ? { type: args.type } : {}),
    ...(args.priority ? { priority: args.priority } : {}),
    ...(args.search ? { search: args.search } : {}),
  };

  // A parent's subtasks are listed whatever their status (it's a checklist), unless a status filter is given.
  const listsSubtasks = typeof args.parent === 'number';
  const openOnly =
    (!args.status && !args.category && !args.includeClosed && !listsSubtasks) || args.due === 'overdue';
  const statuses = resolveStatusFilter({ status: args.status, category: args.category, open: openOnly });
  if (statuses) filters.statuses = statuses;
  if (args.due)
    Object.assign(filters, resolveDueFilter(args.due as TaskDueFilter, resolveGroupTimezone(group.timezone)));

  if (args.assignee) {
    const a = args.assignee.toLowerCase();
    if (a === 'none' || a === 'unassigned') filters.assigneeId = null;
    else filters.assigneeId = (await resolveAssignee(ctx, group, args.assignee))._id as mongoose.Types.ObjectId;
  }
  if (args.epic) {
    filters.epicId =
      args.epic.toLowerCase() === 'none'
        ? null
        : ((await resolveEpic(group, args.epic))._id as mongoose.Types.ObjectId);
  }
  if (args.parent === 'none') {
    filters.parentTaskId = null;
  } else if (listsSubtasks) {
    filters.parentTaskId = (await resolveTask(group, args.parent as number))._id as mongoose.Types.ObjectId;
  }
  return filters;
}

export const listTasksTool = defineTool({
  name: 'list_tasks',
  title: 'List tasks',
  description:
    'Lists tasks of a group, newest first, with filters (status, category, assignee, epic, parent, type, priority, due, search). ' +
    'Subtasks are listed too (marked "subtask of #N"); pass parent "none" to hide them, or a task number for its subtasks. ' +
    'By default only OPEN tasks are listed. Paginated: check `hasMore` and ask for the next `page`.',
  inputSchema,
  annotations: READ_ONLY,
  handler: async (args, ctx) => {
    const group = await requireGroup(ctx, args.group);
    const filters = await buildFilters(ctx, group, args);
    const { tasks, total, hasMore } = await taskService.getTasksByGroup(group._id as mongoose.Types.ObjectId, filters);
    const items = await summarizeTasks(tasks);

    const page = filters.page ?? 1;
    const lines = [
      total === 0
        ? 'No tasks match.'
        : `${total} task${total === 1 ? '' : 's'} match — page ${page}${hasMore ? ` (more: page ${page + 1})` : ''}:`,
      ...items.map((t) => `- ${taskLine(t)}`),
    ];
    return {
      text: lines.join('\n'),
      data: { tasks: items, page, limit: filters.limit, total, hasMore },
    };
  },
});
