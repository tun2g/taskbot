import {
  EPIC_COLOR_EMOJI,
  EpicColor,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@tbot/shared';
import { formatDueDate } from 'src/api/validation';
import { ITask } from 'src/database/models/task.model';
import { userDisplayName } from 'src/shared/services/task-event-lines';
import { buildAppLink } from 'src/shared/utils/app-links';

/** "🔄 In progress" → "In progress" (keeps "@an" and "#12"). */
export function stripEmoji(label: string): string {
  return label.replace(/^[^\p{L}\p{N}@#]+/u, '').trim();
}

export const statusWord = (status: string) => stripEmoji(TASK_STATUS_LABELS[status as TaskStatus] ?? status);
export const priorityWord = (priority: string) =>
  stripEmoji(TASK_PRIORITY_LABELS[priority as TaskPriority] ?? priority);
export const typeWord = (type: string) => stripEmoji(TASK_TYPE_LABELS[type as TaskType] ?? type);

interface PersonLike {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  telegramUserId?: number;
}

function isPerson(value: unknown): value is PersonLike {
  return !!value && typeof value === 'object' && 'telegramUserId' in (value as object);
}

/** "@an" / "An Nguyen" for a populated user ref; null when unassigned or not populated. */
export function personOf(ref: unknown): string | null {
  return isPerson(ref) ? userDisplayName(ref as never) : null;
}

export interface EpicSummary {
  id: string;
  title: string;
}

export function epicSummaryOf(ref: unknown): EpicSummary | null {
  if (!ref || typeof ref !== 'object' || !('title' in (ref as object))) return null;
  const epic = ref as { _id: unknown; title: string };
  return { id: String(epic._id), title: epic.title };
}

export function epicDot(color: string | undefined | null): string {
  return (color && EPIC_COLOR_EMOJI[color as EpicColor]) || '';
}

/** The compact, ObjectId-free shape of a task every tool returns. */
export interface TaskSummary {
  number: number;
  title: string;
  status: string;
  type: string;
  priority: string;
  assignee: string | null;
  dueDate: string | null;
  epic: EpicSummary | null;
  url: string | null;
}

export function taskSummary(task: ITask): TaskSummary {
  return {
    number: task.taskNumber,
    title: task.title,
    status: task.status,
    type: task.type || 'task',
    priority: task.priority || 'medium',
    assignee: personOf(task.assigneeId),
    dueDate: formatDueDate(task.dueDate),
    epic: epicSummaryOf(task.epicId),
    url: buildAppLink(String(task.groupId), String(task._id)),
  };
}

/** "#12 Fix login — In progress · Bug · High · @an · due 2026-10-21 · epic Login" */
export function taskLine(task: TaskSummary): string {
  const parts = [statusWord(task.status), typeWord(task.type), `${priorityWord(task.priority)} priority`];
  parts.push(task.assignee ?? 'unassigned');
  if (task.dueDate) parts.push(`due ${task.dueDate}`);
  if (task.epic) parts.push(`epic ${task.epic.title}`);
  return `#${task.number} ${task.title} — ${parts.join(' · ')}`;
}
