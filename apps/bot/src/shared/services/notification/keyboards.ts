import { isClosedStatus } from '@tbot/shared';
import { PRIMARY_ACTION, statusLabel } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { openTaskLabel, taskButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

/**
 * DM quick actions: `tdm:<status>:<taskId>` (or `tdm:noop:<taskId>` for a state-only button).
 * Self-contained — no Redis entry to expire — and under Telegram's 64-byte limit.
 * Handled in task-callback.handler (only the DM's buttons change, never its text).
 */
export const DM_TASK_CALLBACK_PREFIX = 'tdm:';

/** "✅ Marked done" / "🚫 Cancelled" — a closed task shows its state instead of an action. */
function closedStateText(status: string): string {
  return status === 'done' ? '✅ Marked done' : statusLabel(status);
}

/** `tdm:close:<taskId>` — "✅ Done #N" that closes the task whatever its status (all subtasks done, confirmed closes). */
export const DM_CLOSE_ACTION = 'close';

/** `tdm:explain:<taskId>` — "💡 Explain" under a DM: a short AI explanation of the task, as a new DM. */
export const DM_EXPLAIN_ACTION = 'explain';

/**
 * Assignee DM keyboard: [next status step, e.g. ▶ Start / 👀 Review / ✅ Done] [💡 Explain] [📱 Open #N].
 * Closed tasks get a state button instead of a step.
 */
export function dmTaskKeyboard(task: ITask): InlineKeyboardButton[][] {
  const taskId = task._id.toString();
  const row: InlineKeyboardButton[] = [];
  if (isClosedStatus(task.status)) {
    row.push({ text: closedStateText(task.status), callback_data: `${DM_TASK_CALLBACK_PREFIX}noop:${taskId}` });
  } else {
    const next = PRIMARY_ACTION[task.status] || PRIMARY_ACTION.todo;
    row.push({ text: next.text, callback_data: `${DM_TASK_CALLBACK_PREFIX}${next.to}:${taskId}` });
  }
  row.push({ text: '💡 Explain', callback_data: `${DM_TASK_CALLBACK_PREFIX}${DM_EXPLAIN_ACTION}:${taskId}` });
  const open = taskButton(task);
  if (open) row.push(open);
  return [row];
}

/** [✅ Done #N] [📱 Open #N] — closes the parent whose subtasks are all done. */
export function closeParentKeyboard(parent: ITask): InlineKeyboardButton[][] {
  const row: InlineKeyboardButton[] = [
    { text: `✅ Done #${parent.taskNumber}`, callback_data: `${DM_TASK_CALLBACK_PREFIX}${DM_CLOSE_ACTION}:${parent._id}` },
  ];
  const open = taskButton(parent);
  if (open) row.push(open);
  return [row];
}

/** The open button, relabelled for the creator of an unassigned task: "👤 Assign #N" (or "👤 Assign on card"). */
export function assignButton(task: ITask): InlineKeyboardButton | null {
  const open = taskButton(task);
  if (!open || !('url' in open)) return open;
  const text = open.text === openTaskLabel(task.taskNumber) ? `👤 Assign #${task.taskNumber}` : '👤 Assign on card';
  return { text, url: open.url };
}

/** How to assign without the app: the card's 👤 Assign, or /ai when the task has no card (/sub, /ai, MCP batches). */
export function assignHint(task: ITask): string {
  if (task.taskCardMessageId) return 'Use 👤 Assign on its card in the group.';
  return `Assign it in the group with \`/ai giao #${task.taskNumber} cho @name\`.`;
}

export function openOnly(task: ITask): InlineKeyboardButton[][] {
  const open = taskButton(task);
  return open ? [[open]] : [];
}
