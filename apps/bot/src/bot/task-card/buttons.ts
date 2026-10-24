import { ITask } from 'src/database/models/task.model';
import { appLinkButton, openTaskLabel } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';
import { storeTaskCallbackData } from 'src/bot/task-card/callback-data';

// ── Keyboards (max 3 buttons per row, stable layout) ──

/** Primary next step per status: [status to move to, button text]. */
export const PRIMARY_ACTION: Record<string, { to: string; text: string }> = {
  backlog: { to: 'in_progress', text: '▶ Start' },
  todo: { to: 'in_progress', text: '▶ Start' },
  in_progress: { to: 'in_review', text: '👀 Review' },
  in_review: { to: 'done', text: '✅ Done' },
  pending: { to: 'in_progress', text: '▶ Resume' },
  done: { to: 'todo', text: '🔄 Reopen' },
  cancelled: { to: 'todo', text: '🔄 Reopen' },
};

/** Main card keyboard: [primary next step] [👤 Assign] [⋯ More] / [📱 Open #N] (when the app link exists). */
export async function buildTaskButtons(task: ITask, _userId?: string): Promise<InlineKeyboardButton[][]> {
  const taskId = task._id.toString();
  const primary = PRIMARY_ACTION[task.status] || PRIMARY_ACTION.todo;

  const rows: InlineKeyboardButton[][] = [
    [
      { text: primary.text, callback_data: await storeTaskCallbackData(taskId, 'set_status', { value: primary.to }) },
      { text: '👤 Assign', callback_data: await storeTaskCallbackData(taskId, 'assign') },
      { text: '⋯ More', callback_data: await storeTaskCallbackData(taskId, 'more') },
    ],
  ];
  // Full-width row of its own: easy to hit on a phone, and the action row keeps its layout.
  const open = appLinkButton(openTaskLabel(task.taskNumber), task.groupId, taskId);
  if (open) rows.push([open]);
  return rows;
}

/**
 * "⋯ More" keyboard: [🔁 Status] [🏷 Type] [🔼 Priority] / [💡 Explain] [🗑 Delete] [« Back].
 * A task that can have subtasks (not a subtask itself) gets [🧩 Subtasks] [💡 Explain] [🗑 Delete] / [« Back].
 */
export async function buildMoreButtons(task: ITask): Promise<InlineKeyboardButton[][]> {
  const taskId = task._id.toString();
  const rows: InlineKeyboardButton[][] = [
    [
      { text: '🔁 Status', callback_data: await storeTaskCallbackData(taskId, 'status') },
      { text: '🏷 Type', callback_data: await storeTaskCallbackData(taskId, 'type') },
      { text: '🔼 Priority', callback_data: await storeTaskCallbackData(taskId, 'priority') },
    ],
  ];

  const explain = { text: '💡 Explain', callback_data: await storeTaskCallbackData(taskId, 'explain') };
  const del = { text: '🗑 Delete', callback_data: await storeTaskCallbackData(taskId, 'delete') };
  const back = { text: '« Back', callback_data: await storeTaskCallbackData(taskId, 'back') };
  if (task.parentTaskId) {
    rows.push([explain, del, back]);
  } else {
    rows.push([{ text: '🧩 Subtasks', callback_data: await storeTaskCallbackData(taskId, 'subtasks') }, explain, del]);
    rows.push([back]);
  }
  return rows;
}

/** Delete confirmation: [🗑 Yes, delete] [« Cancel]. */
export async function buildDeleteConfirmButtons(task: ITask): Promise<InlineKeyboardButton[][]> {
  const taskId = task._id.toString();
  return [
    [
      { text: '🗑 Yes, delete', callback_data: await storeTaskCallbackData(taskId, 'delete_confirm') },
      { text: '« Cancel', callback_data: await storeTaskCallbackData(taskId, 'back') },
    ],
  ];
}

/** `subtaskCount` > 0 adds what happens to the subtasks (they're kept as regular tasks). */
export function deleteConfirmText(task: ITask, subtaskCount = 0): string {
  const lines = [`🗑 *Delete #${task.taskNumber} for everyone?*`, "This removes the task from the board and can't be undone."];
  if (subtaskCount > 0) {
    lines.push(subtaskCount === 1 ? 'Its subtask stays as a regular task.' : `Its ${subtaskCount} subtasks stay as regular tasks.`);
  }
  return lines.join('\n');
}
