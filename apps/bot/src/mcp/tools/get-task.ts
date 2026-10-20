import { formatDueDate } from 'src/api/validation';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { requireGroup } from 'src/mcp/resolve/group';
import { personOf, priorityWord, statusWord, taskSummary, typeWord } from 'src/mcp/format/task';
import { resolveTask } from 'src/mcp/resolve/task';
import { defineTool, groupArg, READ_ONLY, taskNumberArg } from 'src/mcp/tools/types';

const ACTIVITY_SHOWN = 10;
const SOURCE_TEXT_MAX = 500;

const ACTION_WORDS: Record<string, string> = {
  created: 'created',
  deleted: 'deleted',
  status: 'status',
  assignee: 'assignee',
  priority: 'priority',
  type: 'type',
  title: 'title',
  description: 'description',
  due_date: 'due date',
  epic: 'epic',
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const getTaskTool = defineTool({
  name: 'get_task',
  title: 'Get task details',
  description:
    'Full details of one task by its number: description, status, assignee, due date, epic, the Telegram messages it was created from, ' +
    'and the last 10 history entries.',
  inputSchema: { group: groupArg, taskNumber: taskNumberArg },
  annotations: READ_ONLY,
  handler: async ({ group: groupRef, taskNumber }, ctx) => {
    const group = await requireGroup(ctx, groupRef);
    const task = await resolveTask(group, taskNumber);
    const summary = taskSummary(task);
    const activity = (await taskActivityService.getForTask(task._id as never)).slice(-ACTIVITY_SHOWN);

    const sources = (
      task.sourceMessages?.length ? task.sourceMessages : task.sourceMessage ? [task.sourceMessage] : []
    ).map((m) => ({ from: m.fromName || null, text: clip(m.text || '', SOURCE_TEXT_MAX), link: m.link || null }));
    const history = activity.map((a) => ({
      at: new Date(a.createdAt).toISOString(),
      by: personOf(a.actor),
      action: ACTION_WORDS[a.action] ?? a.action,
      from: a.from ?? null,
      to: a.to ?? null,
      via: a.via,
    }));

    const lines = [
      `#${summary.number} ${summary.title}`,
      `Status: ${statusWord(summary.status)} · Type: ${typeWord(summary.type)} · Priority: ${priorityWord(summary.priority)}`,
      `Assignee: ${summary.assignee ?? 'unassigned'} · Created by: ${personOf(task.createdBy) ?? 'unknown'}`,
      `Due: ${summary.dueDate ?? 'no due date'}${summary.epic ? ` · Epic: ${summary.epic.title} (epicId: ${summary.epic.id})` : ''}`,
      '',
      task.description?.trim() ? `Description:\n${task.description.trim()}` : 'No description.',
    ];
    if (sources.length) {
      lines.push('', 'Created from these chat messages:');
      for (const s of sources) lines.push(`- ${s.from ?? 'Someone'}: ${s.text}`);
    }
    if (history.length) {
      lines.push('', `Last ${history.length} changes:`);
      for (const h of history) {
        const change = h.from || h.to ? `: ${h.from ?? '—'} → ${h.to ?? '—'}` : '';
        lines.push(`- ${h.at.slice(0, 16).replace('T', ' ')} ${h.by ?? 'Someone'} ${h.action}${change} (via ${h.via})`);
      }
    }
    if (summary.url) lines.push('', `Open: ${summary.url}`);

    return {
      text: lines.join('\n'),
      data: {
        task: {
          ...summary,
          description: task.description || null,
          createdBy: personOf(task.createdBy),
          createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : null,
          completedAt: formatDueDate(task.completedAt) ? new Date(task.completedAt as Date).toISOString() : null,
        },
        sourceMessages: sources,
        activity: history,
      },
    };
  },
});
