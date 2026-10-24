import { SUBTASKS_MAX, TASK_STATUS_LABELS, TaskStatus } from '@tbot/shared';

// The refusals of the subtask rules (shown to the person as-is).

export const PARENT_NOT_FOUND_MESSAGE = 'That parent task could not be found in this group. Pick a task from the list.';
export const SUBTASK_OF_SELF_MESSAGE = "A task can't be a subtask of itself.";

/** "#13 is already a subtask of #12…" */
export const nestedSubtaskMessage = (parentNumber: number, grandparentNumber: number | null) =>
  grandparentNumber
    ? `#${parentNumber} is already a subtask of #${grandparentNumber}, and subtasks can't have their own subtasks. Add it to #${grandparentNumber} instead.`
    : `#${parentNumber} is already a subtask, and subtasks can't have their own subtasks.`;
export const hasSubtasksMessage = (taskNumber: number, count: number) =>
  `#${taskNumber} has ${count} subtask${count === 1 ? '' : 's'} of its own, so it can't become a subtask. Move or detach them first.`;
export const subtasksFullMessage = (parentNumber: number) =>
  `#${parentNumber} already has ${SUBTASKS_MAX} subtasks, the most a task can have. Group bigger work in an epic instead.`;
export const closedParentMessage = (parentNumber: number, status: string) =>
  `#${parentNumber} is ${statusWord(status)}, so it can't take new subtasks. Reopen it first, or add these as regular tasks.`;
export const subtaskEpicMessage = (parentNumber: number) =>
  `A subtask always stays in its parent's epic. Change the epic on #${parentNumber} instead (its subtasks follow).`;

/** "✅ Done" → "done" */
const statusWord = (status: string) =>
  (TASK_STATUS_LABELS[status as TaskStatus] ?? status).replace(/^[^\p{L}]+/u, '').toLowerCase();
