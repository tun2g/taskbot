import type { ITask } from 'src/database/models/task.model';

// Group posts for several tasks created at once (app, MCP, web chat): when they are all subtasks of ONE task,
// the headline says so ("🧩 @an added 3 subtasks to #42 · Fix login (via Claude Code)") and the lines skip the
// "↳ #42" each subtask would otherwise carry.

export interface ParentRef {
  taskNumber: number;
  title: string;
}

/** A created task's parent when `parentTaskId` is populated (`{ taskNumber, title }`), else null. */
export function parentRefOf(task: Pick<ITask, 'parentTaskId'>): ParentRef | null {
  const ref = task.parentTaskId as unknown;
  if (ref && typeof ref === 'object' && 'taskNumber' in (ref as object)) {
    const { taskNumber, title } = ref as { taskNumber: number; title?: string };
    return { taskNumber, title: title ?? '' };
  }
  return null;
}

/** The parent every task shares, or null (no parent, mixed parents, or not populated). */
export function sharedParentOf(tasks: Pick<ITask, 'parentTaskId'>[]): ParentRef | null {
  const first = tasks.length ? parentRefOf(tasks[0]) : null;
  if (!first) return null;
  return tasks.every((t) => parentRefOf(t)?.taskNumber === first.taskNumber) ? first : null;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shorten = (text: string, max = 60) => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};

/**
 * The bold first line of a multi-task group post (HTML):
 * `🧩 @an added 3 subtasks to #42 · Fix login (via Claude Code)` when all share a parent, else
 * `🤖 @an created 3 tasks (via Claude Code)`.
 */
export function createdSummaryHeader(actorName: string, tasks: Pick<ITask, 'parentTaskId'>[], via: string): string {
  const who = escapeHtml(actorName);
  const parent = sharedParentOf(tasks);
  const n = tasks.length;
  if (parent) {
    const title = parent.title ? ` · ${escapeHtml(shorten(parent.title))}` : '';
    return `<b>🧩 ${who} added ${n} subtask${n === 1 ? '' : 's'} to #${parent.taskNumber}${title} (via ${escapeHtml(via)})</b>`;
  }
  return `<b>🤖 ${who} created ${n} task${n === 1 ? '' : 's'} (via ${escapeHtml(via)})</b>`;
}
