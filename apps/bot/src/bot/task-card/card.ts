import { TaskStatus } from '@tbot/shared';
import { parentLine, populatedParent, progressLine } from 'src/bot/subtasks/subtask-lines';
import { ITask } from 'src/database/models/task.model';
import type { SubtaskProgress } from 'src/database/services/subtask.service';
import { IUser } from 'src/database/models/user.model';
import { describeDue, safeTimezone } from 'src/bot/task-card/dates';
import { priorityLabel, statusLabel, typeEmoji, typeWord } from 'src/bot/task-card/labels';
import { epicTag, escapeMarkdown, mdName, populatedUser, truncate } from 'src/bot/task-card/text';

// All bot messages use Telegram's legacy `Markdown` parse mode. User text is only ever
// interpolated OUTSIDE entities (never inside *bold*), escaped with `escapeMarkdown`.

// ── Card ──

function sourceLine(task: ITask): string | null {
  const source = task.sourceMessages?.length ? task.sourceMessages[0] : task.sourceMessage;
  if (!source) return null;

  const snippet = truncate(source.text, 80);
  const name = (source.fromName || '').replace(/[[\]]/g, '').trim();
  const quote = snippet ? `“${escapeMarkdown(snippet)}”` : '';
  const more = task.sourceMessages && task.sourceMessages.length > 1 ? ` (+${task.sourceMessages.length - 1} more)` : '';

  if (source.link) {
    const label = name ? `From ${name}` : 'Source message';
    return `💬 [${label}](${source.link})${quote ? `: ${quote}` : ''}${more}`;
  }
  if (!quote) return null;
  return `💬 ${name ? `From ${escapeMarkdown(name)}: ` : ''}${quote}${more}`;
}

/**
 * Task card text (legacy Markdown). Creator/assignee fall back to the populated refs on the task.
 * `timezone` decides "Due today" vs overdue (defaults to TIMEZONE env). A subtask shows its parent (from the
 * populated ref); a parent shows `subtasks` progress when the caller loaded it (see cardSubtaskProgress).
 */
export function formatTaskCard(
  task: ITask,
  creatorUser?: IUser | null,
  assigneeUser?: IUser | null,
  timezone?: string,
  subtasks?: SubtaskProgress | null,
): string {
  const creator = creatorUser ?? populatedUser(task.createdBy);
  const assignee = assigneeUser ?? populatedUser(task.assigneeId);
  const completer = populatedUser(task.completedBy);
  const tz = safeTimezone(timezone);

  const lines: string[] = [];
  lines.push(`${typeEmoji(task.type)} *${typeWord(task.type)} #${task.taskNumber}* · ${escapeMarkdown(task.title)}`);
  const parent = parentLine(populatedParent(task.parentTaskId));
  if (parent) lines.push(parent);
  lines.push(`Status: ${statusLabel(task.status)}`);
  lines.push(`Priority: ${priorityLabel(task.priority)}`);
  const epic = epicTag(task.epicId);
  if (epic) lines.push(`Epic: ${epic}`);
  const progress = progressLine(subtasks);
  if (progress) lines.push(progress);
  if (assignee) lines.push(`Assignee: ${mdName(assignee)}`);

  const due = describeDue(task, tz);
  if (due) lines.push(`Due: ${due}`);

  if (task.status === TaskStatus.DONE && completer) lines.push(`Done by: ${mdName(completer)}`);
  if (creator) lines.push(`Created by: ${mdName(creator)}`);

  const source = sourceLine(task);
  if (source) lines.push('', source);

  return lines.join('\n');
}
