import type { ITask, IUser } from '@tbot/shared';
import { isClosedStatus, TASK_STATUS_LABELS, TaskStatus } from '@tbot/shared';

import { Avatar, splitLabel, StatusLozenge, statusText } from '@/components/ui/badges';

import { SubtaskRowMenu } from './subtask-row-menu';

interface SubtaskRowProps {
  groupId: string;
  task: ITask;
  parentNumber: number;
  members: IUser[];
  onOpen: (task: ITask) => void;
  onStatusChange: (task: ITask, status: TaskStatus) => void;
  onParentChange: (task: ITask, parent: ITask | null) => void;
}

/** The round toggle: green ✓ when done, grey ✕ when cancelled, empty when open. */
function DoneMark({ status }: { status: TaskStatus }) {
  const done = status === TaskStatus.DONE;
  const cancelled = status === TaskStatus.CANCELLED;
  return (
    <span
      aria-hidden
      className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 text-[11px] font-bold leading-none transition-colors ${
        done
          ? 'border-[var(--tbot-success)] bg-[var(--tbot-success)] text-white'
          : cancelled
            ? 'border-tg-hint/60 bg-tg-hint/20 text-tg-hint'
            : 'border-tg-hint/70 text-transparent group-hover:border-[var(--tbot-success)] group-hover:text-[var(--tbot-success)]'
      }`}
    >
      {cancelled ? '✕' : '✓'}
    </span>
  );
}

/**
 * One subtask: done toggle · #key · title (opens it) · status · assignee · ⋯ (status / move / remove).
 * Phones show the status as its emoji, so "in review" and "to do" still look different.
 */
export function SubtaskRow({
  groupId,
  task,
  parentNumber,
  members,
  onOpen,
  onStatusChange,
  onParentChange,
}: SubtaskRowProps) {
  const closed = isClosedStatus(task.status);
  // Reopening goes to "In progress": whoever ticks it back is usually still on it (Undo restores the exact status).
  const toggleTo = closed ? TaskStatus.IN_PROGRESS : TaskStatus.DONE;
  const toggleLabel = closed ? `Reopen #${task.taskNumber} (In progress)` : `Mark #${task.taskNumber} as done`;
  const statusEmoji = splitLabel(TASK_STATUS_LABELS[task.status]).icon;

  return (
    <li className="flex items-center gap-1 pr-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={task.status === TaskStatus.DONE ? true : closed ? 'mixed' : false}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={() => onStatusChange(task, toggleTo)}
        className="focus-ring group flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-tg-secondary active:bg-tg-secondary"
      >
        <DoneMark status={task.status} />
      </button>

      <button
        type="button"
        onClick={() => onOpen(task)}
        className="focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-tg-secondary/60 active:bg-tg-secondary"
      >
        <span className="shrink-0 font-mono text-xs text-tg-hint">#{task.taskNumber}</span>
        <span
          className={`min-w-0 flex-1 truncate text-sm ${closed ? 'text-tg-hint line-through decoration-tg-hint/60' : 'text-tg-text'}`}
        >
          {task.title}
        </span>
        <span aria-hidden className="shrink-0 text-sm leading-none sm:hidden">
          {statusEmoji}
        </span>
        <span className="sr-only sm:hidden">{statusText(task.status)}</span>
        <StatusLozenge status={task.status} className="hidden shrink-0 sm:inline-flex" />
        <Avatar user={task.assigneeId} members={members} />
      </button>

      <SubtaskRowMenu
        groupId={groupId}
        task={task}
        parentNumber={parentNumber}
        onStatusChange={onStatusChange}
        onParentChange={onParentChange}
      />
    </li>
  );
}
