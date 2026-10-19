import type { ITask, IUser } from '@tbot/shared';
import { isClosedStatus, TaskStatus } from '@tbot/shared';

import { Avatar, PriorityIcon, StatusLozenge, TypeIcon } from '@/components/ui/badges';

import { DueChip } from './due-chip';
import { StatusMenu } from './status-menu';

interface TaskCardProps {
  task: ITask;
  members?: IUser[];
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
export function TaskCard({ task, members, timeZone, showStatus, onClick, onStatusChange, isOverlay }: TaskCardProps) {
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
      className={`relative select-none rounded-md bg-tg-section px-3 pb-2.5 pt-2 text-left shadow-[0_1px_1px_color-mix(in_srgb,var(--tg-theme-text-color)_18%,transparent)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-tg-link ${
        onClick ? 'cursor-pointer hover:bg-tg-secondary/40' : ''
      } ${isOverlay ? 'rotate-2 shadow-xl ring-2 ring-tg-link' : ''}`}
      style={{ WebkitTouchCallout: 'none' }}
    >
      <div className="flex items-start gap-2">
        <p className={`line-clamp-2 min-h-11 flex-1 pt-1.5 text-sm leading-snug text-tg-text ${closed ? 'text-tg-hint line-through decoration-tg-hint/60' : ''}`}>
          {task.title}
        </p>
        {onStatusChange && !isOverlay && (
          <div className="-mr-2 -mt-0.5">
            <StatusMenu task={task} onChange={onStatusChange} />
          </div>
        )}
      </div>

      {showStatus && (
        <div className="mt-1">
          <StatusLozenge status={task.status} />
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <TypeIcon type={task.type} />
        <span className={`font-mono text-xs font-medium text-tg-hint ${closed ? 'line-through' : ''}`}>#{task.taskNumber}</span>
        <PriorityIcon priority={task.priority} />
        <DueChip dueDate={task.dueDate} timeZone={timeZone} status={task.status} />
        <span className="ml-auto">
          <Avatar user={task.assigneeId} members={members} />
        </span>
      </div>
    </div>
  );
}
