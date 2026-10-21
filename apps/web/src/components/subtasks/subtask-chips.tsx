import type { ITask } from '@tbot/shared';

import { getParent, getParentId, getProgress, isProgressComplete, progressText } from '@/lib/subtasks';

const chip = 'inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-semibold leading-none';

/** "↳ #42" chip (desktop list rows, where the parent's title is one hover away). */
export function ParentChip({ task }: { task: Pick<ITask, 'parentTaskId'> }) {
  const parent = getParent(task);
  if (!getParentId(task)) return null;
  const label = parent ? `#${parent.taskNumber}` : 'subtask';
  return (
    <span
      className={`${chip} tint-neutral`}
      title={parent ? `Subtask of #${parent.taskNumber} ${parent.title}` : 'Subtask'}
    >
      <span aria-hidden>↳</span>
      <span className="sr-only">Subtask of </span>
      <span className="font-mono">{label}</span>
    </span>
  );
}

/**
 * "↳ Subtask of #42 Fix login" as a small second line under a card / row title — readable on phones,
 * where there is no hover to reveal the parent.
 */
export function ParentLine({ task, className = '' }: { task: Pick<ITask, 'parentTaskId'>; className?: string }) {
  if (!getParentId(task)) return null;
  const parent = getParent(task);
  return (
    <span className={`flex min-w-0 items-center gap-1 text-xs text-tg-hint ${className}`}>
      <span aria-hidden className="shrink-0">
        ↳
      </span>
      <span className="sr-only">Subtask of</span>
      {parent ? (
        <>
          <span className="shrink-0 font-mono">#{parent.taskNumber}</span>
          <span className="min-w-0 truncate">{parent.title}</span>
        </>
      ) : (
        <span>Subtask</span>
      )}
    </span>
  );
}

/** "☑ 2/5" on a parent's card / row; green once every subtask that counts is done (cancelled ones don't). */
export function SubtaskProgressChip({ task }: { task: Pick<ITask, 'subtaskProgress'> }) {
  const progress = getProgress(task);
  if (!progress || progress.total === 0) return null;
  const complete = isProgressComplete(progress);
  const text = `Subtasks: ${progressText(progress)}`;
  return (
    <span className={`${chip} ${complete ? 'lozenge-done' : 'tint-neutral'}`} title={text}>
      <span aria-hidden>☑</span>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="tabular-nums">
        {progress.done}/{progress.total}
      </span>
    </span>
  );
}

/** Both chips; at most one renders (a subtask never has subtasks). */
export function SubtaskChips({ task }: { task: Pick<ITask, 'parentTaskId' | 'subtaskProgress'> }) {
  return (
    <>
      <ParentChip task={task} />
      <SubtaskProgressChip task={task} />
    </>
  );
}
