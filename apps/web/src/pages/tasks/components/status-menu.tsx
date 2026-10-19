import type { ITask } from '@tbot/shared';
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER, TaskStatus } from '@tbot/shared';

/**
 * ⋯ button with a native "Move to…" menu — the non-drag way to change status. Native select
 * keeps it accessible (keyboard, screen readers) and gives phones their own picker.
 */
export function StatusMenu({ task, onChange }: { task: ITask; onChange: (task: ITask, status: TaskStatus) => void }) {
  return (
    <label
      className="relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-lg text-tg-hint hover:bg-tg-secondary"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      title="Move to…"
    >
      <span aria-hidden>⋯</span>
      <select
        aria-label={`Move #${task.taskNumber} to status`}
        value={task.status}
        onChange={(e) => onChange(task, e.target.value as TaskStatus)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {TASK_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {s === task.status ? `${TASK_STATUS_LABELS[s]} (current)` : `Move to ${TASK_STATUS_LABELS[s]}`}
          </option>
        ))}
      </select>
    </label>
  );
}
