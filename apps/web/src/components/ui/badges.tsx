import type { IUser, UserRef } from '@tbot/shared';
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_HINTS,
  TASK_STATUS_LABELS,
  TASK_TYPE_HINTS,
  TASK_TYPE_LABELS,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@tbot/shared';

import { displayName, getUserId, initials } from '@/lib/user';

/** "📝 To do" → { icon: "📝", text: "To do" } */
export function splitLabel(label: string): { icon: string; text: string } {
  const [icon, ...rest] = label.split(' ');
  return { icon, text: rest.join(' ') };
}

export function statusText(status: TaskStatus): string {
  return splitLabel(TASK_STATUS_LABELS[status] ?? 'Unknown status').text || 'Unknown status';
}

/** Jira-style lozenge: small, uppercase, bold. Hue by category, shade by status. */
export function StatusLozenge({ status, className = '' }: { status: TaskStatus; className?: string }) {
  return (
    <span className={`lozenge lozenge-${status} ${className}`} title={TASK_STATUS_HINTS[status]}>
      {statusText(status)}
    </span>
  );
}

export function TypeIcon({ type, withLabel }: { type?: TaskType | null; withLabel?: boolean }) {
  const t = type && TASK_TYPE_LABELS[type] ? type : TaskType.TASK;
  const { icon, text } = splitLabel(TASK_TYPE_LABELS[t]);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${text} — ${TASK_TYPE_HINTS[t]}`}>
      <span aria-hidden>{icon}</span>
      {withLabel ? <span>{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}

export function PriorityIcon({ priority, withLabel }: { priority: TaskPriority; withLabel?: boolean }) {
  const { icon, text } = splitLabel(TASK_PRIORITY_LABELS[priority] ?? '❔ Unknown');
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${text} priority`}>
      <span aria-hidden className="text-[0.9em]">{icon}</span>
      {withLabel ? <span>{text}</span> : <span className="sr-only">{text} priority</span>}
    </span>
  );
}

/** Telegram's own avatar palette, picked by a stable hash of the user id. */
const AVATAR_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface AvatarProps {
  user: UserRef | null | undefined;
  members?: IUser[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Avatar({ user, members, size = 'sm', className = '' }: AvatarProps) {
  const id = getUserId(user);
  const dims = size === 'lg' ? 'h-9 w-9 text-sm' : size === 'md' ? 'h-7 w-7 text-xs' : 'h-6 w-6 text-[11px]';
  const name = id ? displayName(user, { members }) : 'Unassigned';
  if (!id) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-tg-hint text-tg-hint ${dims} ${className}`}
        title="Unassigned"
        aria-label="Unassigned"
      >
        ?
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dims} ${className}`}
      style={{ backgroundColor: colorFor(id) }}
      title={name}
      aria-label={name}
    >
      {initials(user, members)}
    </span>
  );
}
