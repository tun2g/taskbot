import { statusesInCategory, TaskStatusCategory } from '@tbot/shared';
import { describeFilters, OPEN_STATUSES, ParsedFilters } from 'src/bot/commands/list/filters';
import { listSuffixHtml, populatedParent } from 'src/bot/subtasks/subtask-lines';
import { displayName, populatedUser, STATUS_EMOJI, truncate, typeWord } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { SubtaskProgress, subtaskService } from 'src/database/services/subtask.service';
import { taskService } from 'src/database/services/task.service';
import { escapeHtml } from 'src/shared/services/task-event-lines';
import { taskNumberHtml } from 'src/shared/utils/app-links';

const LIST_LIMIT = 15;

type GroupId = Parameters<typeof taskService.getTaskStats>[0];
export type ListTotals = { todo: number; inProgress: number; done: number };

/** To do / in progress / done counts over the whole group. */
export async function groupTotals(groupId: GroupId): Promise<ListTotals> {
  const stats = await taskService.getTaskStats(groupId);
  const sumOf = (cat: TaskStatusCategory) =>
    statusesInCategory(cat).reduce((sum, status) => sum + (stats[status] || 0), 0);
  return {
    todo: sumOf(TaskStatusCategory.TODO),
    inProgress: sumOf(TaskStatusCategory.IN_PROGRESS),
    done: sumOf(TaskStatusCategory.DONE),
  };
}

/** A status filter wins; otherwise open tasks (to do + in progress). Newest first, at most LIST_LIMIT. */
export async function fetchListedTasks(
  groupId: GroupId,
  filters: ParsedFilters,
): Promise<{ tasks: ITask[]; matchCount: number }> {
  const statuses = filters.status ? filters.status.statuses : OPEN_STATUSES;
  const results = await Promise.all(
    statuses.map((status) =>
      taskService.getTasksByGroup(groupId, {
        status,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.assignee ? { assigneeId: filters.assignee._id } : {}),
        limit: LIST_LIMIT,
      }),
    ),
  );
  const matchCount = results.reduce((sum, r) => sum + (r.total || 0), 0);
  const tasks = results
    .flatMap((r) => r.tasks || [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, LIST_LIMIT);
  return { tasks, matchCount };
}

/**
 * "🔄 #14 Bug · Fix login on iOS — @an" (HTML; #14 opens the task when the app link exists).
 * A subtask ends its title with "↳ #12"; a parent with "· 🧩 2/5".
 */
export function formatLine(task: ITask, groupId: { toString(): string }, subtasks?: SubtaskProgress): string {
  const emoji = STATUS_EMOJI[task.status] || STATUS_EMOJI.todo;
  const assignee = populatedUser(task.assigneeId);
  const who = assignee ? ` — ${escapeHtml(displayName(assignee))}` : '';
  const num = taskNumberHtml(task.taskNumber, groupId, task._id);
  const sub = listSuffixHtml(populatedParent(task.parentTaskId), subtasks);
  return `${emoji} ${num} ${typeWord(task.type)} · ${escapeHtml(truncate(task.title, 60))}${sub}${who}`;
}

/** The /list message body (HTML lines). */
export async function buildListLines(input: {
  chatTitle: string;
  groupId: { toString(): string };
  totals: ListTotals;
  filters: ParsedFilters;
  isFiltered: boolean;
  tasks: ITask[];
  matchCount: number;
  hasBoard: boolean;
}): Promise<string[]> {
  const { chatTitle, totals, filters, isFiltered, tasks, matchCount } = input;
  const lines: string[] = [];

  if (!isFiltered) {
    lines.push(`📋 <b>Tasks</b> · ${escapeHtml(chatTitle)}`);
    lines.push(`${totals.todo} to do · ${totals.inProgress} in progress · ${totals.done} done`);
  } else {
    lines.push(`📋 ${describeFilters(filters)} (${matchCount})`);
  }

  if (tasks.length === 0) {
    lines.push('');
    lines.push(isFiltered ? 'Nothing matches. Try <code>/list</code> for everything open.' : 'Nothing open right now. 🎉');
  } else {
    lines.push('');
    // One query: "🧩 2/5" after parents in the list.
    const progress = await subtaskService.progress(tasks.filter((t) => !t.parentTaskId).map((t) => String(t._id)));
    for (const task of tasks) lines.push(formatLine(task, input.groupId, progress.get(String(task._id))));
    if (matchCount > tasks.length) {
      const more = matchCount - tasks.length;
      // Only point at the board when there's a button for it
      lines.push(
        input.hasBoard
          ? `…and ${more} more — open the board`
          : `…and ${more} more — narrow it down, e.g. <code>/list bug</code> or <code>/list @name</code>`,
      );
    }
  }

  if (!isFiltered) {
    lines.push('');
    lines.push('Filter: <code>/mytasks</code>, <code>/list bug</code>, <code>/list @name</code>');
  }
  return lines;
}
