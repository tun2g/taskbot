import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TASK_TYPE_LABELS,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@tbot/shared';

// Emoji meanings come from @tbot/shared labels so cards, DMs, digest and /tasks agree.

/** "🔄 In progress" → "In progress" */
export function labelWord(label: string): string {
  return label.split(' ').slice(1).join(' ');
}

/** "🔄 In progress" → "🔄" */
function labelEmoji(label: string): string {
  return label.split(' ')[0];
}

export const STATUS_EMOJI: Record<string, string> = Object.fromEntries(
  TASK_STATUS_ORDER.map((status) => [status, labelEmoji(TASK_STATUS_LABELS[status])]),
);

export function statusLabel(status: string): string {
  return TASK_STATUS_LABELS[status as TaskStatus] || TASK_STATUS_LABELS[TaskStatus.TODO];
}

/** "In progress" (no emoji) */
export function statusWord(status: string): string {
  return labelWord(statusLabel(status));
}

export function typeLabel(type?: string | null): string {
  return TASK_TYPE_LABELS[(type || 'task') as TaskType] || TASK_TYPE_LABELS[TaskType.TASK];
}

export function typeEmoji(type?: string | null): string {
  return typeLabel(type).split(' ')[0];
}

export function typeWord(type?: string | null): string {
  return labelWord(typeLabel(type));
}

export function priorityLabel(priority?: string | null): string {
  return TASK_PRIORITY_LABELS[(priority || 'medium') as TaskPriority] || TASK_PRIORITY_LABELS[TaskPriority.MEDIUM];
}

export function priorityWord(priority?: string | null): string {
  return labelWord(priorityLabel(priority));
}
