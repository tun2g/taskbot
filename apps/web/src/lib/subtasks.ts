import type { ITask, SubtaskProgress, TaskParentRef } from '@tbot/shared';
import { TaskStatus } from '@tbot/shared';

/** A subtask's parent as `{ _id, taskNumber, title, status }` (the API populates it), or null. */
export function getParent(task: Pick<ITask, 'parentTaskId'>): TaskParentRef | null {
  const ref = task.parentTaskId;
  return ref && typeof ref === 'object' ? ref : null;
}

/** Id of the task's parent (populated or bare), or null for a regular task. */
export function getParentId(task: Pick<ITask, 'parentTaskId'>): string | null {
  const ref = task.parentTaskId;
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref._id;
}

export const isSubtask = (task: Pick<ITask, 'parentTaskId'>) => getParentId(task) !== null;

/** Subtask counts when the task has any subtasks (cancelled ones included), else null. */
export function getProgress(task: Pick<ITask, 'subtaskProgress'>): SubtaskProgress | null {
  const p = task.subtaskProgress;
  if (!p) return null;
  const cancelled = p.cancelled ?? 0;
  return p.total > 0 || cancelled > 0 ? { total: p.total, done: p.done, cancelled } : null;
}

/** Every subtask, cancelled ones included (what "delete" / the 50 cap count). */
export const subtaskCount = (p: SubtaskProgress | null) => (p ? p.total + p.cancelled : 0);

/** Open subtasks: neither done nor cancelled. */
export const openSubtaskCount = (task: Pick<ITask, 'subtaskProgress'>) => {
  const p = getProgress(task);
  return p ? p.total - p.done : 0;
};

/** Counts from a loaded subtask list: cancelled ones are left out of `total` / `done` and counted apart. */
export function progressOf(subtasks: Pick<ITask, 'status'>[]): SubtaskProgress {
  const cancelled = subtasks.filter((t) => t.status === TaskStatus.CANCELLED).length;
  const done = subtasks.filter((t) => t.status === TaskStatus.DONE).length;
  return { total: subtasks.length - cancelled, done, cancelled };
}

/** "2/4 done", "2/4 done · 1 cancelled", "All 3 cancelled". */
export function progressText(p: SubtaskProgress): string {
  if (p.total === 0) return p.cancelled ? `All ${p.cancelled} cancelled` : 'No subtasks';
  return `${p.done}/${p.total} done${p.cancelled ? ` · ${p.cancelled} cancelled` : ''}`;
}

/** Every subtask that still counts is done (cancelled ones don't block). */
export const isProgressComplete = (p: SubtaskProgress | null) => !!p && p.total > 0 && p.done === p.total;
