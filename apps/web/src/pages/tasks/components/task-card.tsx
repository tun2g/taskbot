import type { ITask, IUser } from '@tbot/shared';
import { isClosedStatus, TaskStatus } from '@tbot/shared';

import { EpicChip } from '@/components/epics/epic-chip';
import { ParentLine, SubtaskProgressChip } from '@/components/subtasks/subtask-chips';
import { Avatar, PriorityIcon, StatusLozenge, TypeIcon } from '@/components/ui/badges';
import type { EpicRef } from '@/lib/epics';

import { DueChip } from './due-chip';
import { StatusMenu } from './status-menu';

interface TaskCardProps {
  task: ITask;
  members?: IUser[];
  /** Resolves a bare `epicId`; the API normally populates it. */
  epics?: EpicRef[];
  /** Board already filtered to one epic → skip the chip. */
  hideEpic?: boolean;
  timeZone?: string | null;
  /** Show the status lozenge (assignee board, where columns aren't statuses). */
  showStatus?: boolean;
  onClick?: (task: ITask) => void;
  /** Non-drag way to change status (accessible fallback to drag-and-drop). */
  onStatusChange?: (task: ITask, status: TaskStatus) => void;
  /** Rendered as the floating drag preview. */
  isOverlay?: boolean;
}

/** Compact Jira-style board card. */
export function TaskCard({
  task,
  members,
  epics,
  hideEpic,
  timeZone, showStatus, onClick, onStatusChange, isOverlay }: TaskCardProps) {
  const closed = isClosedStatus(task.status);

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `#${task.taskNumber} ${task.title}` : undefined}
      onClick={() => onClick?.(task)}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onClick(task);
        }
      }}
      className={`relative select-none rounded-md bg-tg-section px-3 py-2.5 text-left shadow-[0_1px_2px_color-mix(in_srgb,var(--tg-theme-text-color)_16%,transparent)] outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-tg-link ${
        onClick
          ? 'cursor-pointer hover:shadow-[0_2px_6px_color-mix(in_srgb,var(--tg-theme-text-color)_18%,transparent)]'
          : ''
      } ${isOverlay ? 'rotate-2 shadow-xl ring-2 ring-tg-link' : ''}`}
      style={{ WebkitTouchCallout: 'none' }}
    >
      {/* Line 1: type + key, then the title (wraps; long Vietnamese words break). */}
      <p
        className={`line-clamp-3 text-sm leading-snug [overflow-wrap:anywhere] ${onStatusChange && !isOverlay ? 'pr-8' : ''} ${
          closed ? 'text-tg-hint line-through decoration-tg-hint/60' : 'text-tg-text'
        }`}
      >
        <span className="mr-1.5 inline-flex items-center gap-1 align-[1px] no-underline">
          <TypeIcon type={task.type} />
          <span className={`font-mono text-xs font-medium text-tg-hint ${closed ? 'line-through' : ''}`}>
            #{task.taskNumber}
          </span>
        </span>
        {task.title}
      </p>
      <ParentLine task={task} className={`mt-1 ${onStatusChange && !isOverlay ? 'pr-8' : ''}`} />
      {onStatusChange && !isOverlay && (
        <div className="absolute right-0 top-0">
          <StatusMenu task={task} onChange={onStatusChange} />
        </div>
      )}

      {/* Meta: wraps onto a second row on narrow columns instead of squeezing the epic to a dot. */}
      <div className="mt-2 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
        {showStatus && <StatusLozenge status={task.status} />}
        <PriorityIcon priority={task.priority} />
        <DueChip dueDate={task.dueDate} timeZone={timeZone} status={task.status} />
        <SubtaskProgressChip task={task} />
        {!hideEpic && <EpicChip epic={task.epicId} epics={epics} />}
        <span className="ml-auto shrink-0">
          <Avatar user={task.assigneeId} members={members} />
        </span>
      </div>
    </div>
  );
}
