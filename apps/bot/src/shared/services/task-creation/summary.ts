import { IGroup } from 'src/database/models/group.model';
import { epicLabel, epicOf } from 'src/shared/services/ai-command/format';
import { parentRefOf, sharedParentOf } from 'src/shared/services/created-summary';
import { escapeHtml, SUMMARY_TITLE_MAX, truncate, typeEmoji, userName } from 'src/shared/services/task-creation/text';
import { CreatedTask } from 'src/shared/services/task-creation/types';
import { taskNumberHtml } from 'src/shared/utils/app-links';

/**
 * Summary lines "#12 🐞 Fix login → @an · 🔵 Login" (HTML-escaped; #12 opens the task when an app link
 * exists; the epic only when the AI put the task in one, so a wrong pick is easy to spot).
 */
export function createdSummaryLines(created: CreatedTask[], groupId: IGroup['_id'] | string): string[] {
  // Subtasks of different parents say whose they are; when all share one, the headline says it instead.
  const shared = sharedParentOf(created.map((c) => c.task));
  return created.map(({ task, assignee }) => {
    const who = assignee ? ` → ${escapeHtml(userName(assignee))}` : '';
    const parent = shared ? null : parentRefOf(task);
    const under = parent ? ` ↳ #${parent.taskNumber}` : '';
    const epic = epicOf(task.epicId);
    const inEpic = epic ? ` · ${escapeHtml(epicLabel(epic, 16))}` : '';
    return `${taskNumberHtml(task.taskNumber, groupId, task._id)} ${typeEmoji(task.type)} ${escapeHtml(truncate(task.title, SUMMARY_TITLE_MAX))}${under}${who}${inEpic}`;
  });
}
