import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_HINTS,
  TASK_STATUS_ORDER,
  TASK_TYPE_HINTS,
  TASK_TYPE_ORDER,
} from '@tbot/shared';
import { ITask } from 'src/database/models/task.model';
import { InlineKeyboardButton } from 'telegraf/types';
import { storeTaskCallbackData } from 'src/bot/task-card/callback-data';
import { labelWord, priorityLabel, statusLabel, typeLabel } from 'src/bot/task-card/labels';

/** Picker with every option (current one marked ✅), two per row, then « Back. */
async function buildPicker(
  task: ITask,
  action: string,
  options: string[],
  current: string,
  label: (value: string) => string,
): Promise<InlineKeyboardButton[][]> {
  const taskId = task._id.toString();
  const rows: InlineKeyboardButton[][] = [];
  let row: InlineKeyboardButton[] = [];
  for (const value of options) {
    const text = value === current ? `✅ ${labelWord(label(value))}` : label(value);
    row.push({ text, callback_data: await storeTaskCallbackData(taskId, action, { value }) });
    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: '« Back', callback_data: await storeTaskCallbackData(taskId, 'more') }]);
  return rows;
}

export function buildPriorityPicker(task: ITask): Promise<InlineKeyboardButton[][]> {
  return buildPicker(task, 'set_priority', TASK_PRIORITY_ORDER, task.priority || 'medium', priorityLabel);
}

export function buildTypePicker(task: ITask): Promise<InlineKeyboardButton[][]> {
  return buildPicker(task, 'set_type', TASK_TYPE_ORDER, task.type || 'task', typeLabel);
}

export function buildStatusPicker(task: ITask): Promise<InlineKeyboardButton[][]> {
  return buildPicker(task, 'set_status', TASK_STATUS_ORDER, task.status || 'todo', statusLabel);
}

/** Legend shown under the card while a status picker is open. */
export function statusPickerText(): string {
  return [
    '🔁 *Move to which status?*',
    ...TASK_STATUS_ORDER.map((s) => `${statusLabel(s)} — ${TASK_STATUS_HINTS[s]}`),
  ].join('\n');
}

/** Legend shown under the card while the type picker is open. */
export function typePickerText(): string {
  return ['🏷 *What kind of task is it?*', ...TASK_TYPE_ORDER.map((t) => `${typeLabel(t)} — ${TASK_TYPE_HINTS[t]}`)].join(
    '\n',
  );
}
