import { isClosedStatus, TaskStatus } from '@tbot/shared';
import { cardSubtaskProgress } from 'src/bot/subtasks/card-progress';
import { storeTaskCallbackData } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { DM_CLOSE_ACTION, DM_TASK_CALLBACK_PREFIX } from 'src/shared/services/notification.service';
import { taskButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

// Closing a parent while some of its subtasks are still open asks first (Jira allows it; people usually
// just forgot one). Used by the card buttons, /done and DM quick actions.

/** Open subtasks of `task` (not done, not cancelled); 0 for a subtask or a task without subtasks. */
export async function openSubtaskCount(task: Pick<ITask, '_id' | 'parentTaskId'>): Promise<number> {
  const progress = await cardSubtaskProgress(task);
  return progress ? Math.max(0, progress.total - progress.done) : 0;
}

/** Moving `task` from its status to `to` closes it while subtasks are open → how many (else 0). */
export async function openSubtasksBlockingClose(task: ITask, to: string): Promise<number> {
  if (!isClosedStatus(to) || isClosedStatus(task.status)) return 0;
  return openSubtaskCount(task);
}

/** "⚠️ *#42 still has 2 open subtasks.* Close it anyway?" (legacy Markdown) */
export function closeAnywayText(taskNumber: number, open: number, to: string): string {
  const verb = to === TaskStatus.CANCELLED ? 'Cancel' : 'Close';
  return `⚠️ *#${taskNumber} still has ${open} open subtask${open === 1 ? '' : 's'}.* ${verb} it anyway?`;
}

/** "✅ Yes, close #42" / "❌ Yes, cancel #42" */
export function closeAnywayButtonText(taskNumber: number, to: string): string {
  return to === TaskStatus.CANCELLED ? `❌ Yes, cancel #${taskNumber}` : `✅ Yes, close #${taskNumber}`;
}

/** On the card: [✅ Yes, close #42] [« Back] — "yes" re-sends the status change with `force`. */
export async function closeAnywayCardRows(task: ITask, to: string): Promise<InlineKeyboardButton[][]> {
  const taskId = String(task._id);
  return [
    [
      {
        text: closeAnywayButtonText(task.taskNumber, to),
        callback_data: await storeTaskCallbackData(taskId, 'set_status', { value: to, force: true }),
      },
      { text: '« Back', callback_data: await storeTaskCallbackData(taskId, 'back') },
    ],
  ];
}

/** Under a DM: [✅ Yes, close #42] [📱 Open #42] — "yes" is the DM close action. */
export function closeAnywayDmRows(task: ITask, to: string): InlineKeyboardButton[][] {
  const open = taskButton(task);
  const yes = { text: closeAnywayButtonText(task.taskNumber, to), callback_data: `${DM_TASK_CALLBACK_PREFIX}${DM_CLOSE_ACTION}:${task._id}` };
  return [[yes, ...(open ? [open] : [])]];
}
