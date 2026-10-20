import type { EpicColor, ITask } from '@tbot/shared';
import { EpicStatus } from '@tbot/shared';

import { type EpicRef, epicColorClasses, resolveEpic } from '@/lib/epics';

export function EpicDot({ color, className = '' }: { color: EpicColor | string; className?: string }) {
  return (
    <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${epicColorClasses(color).solid} ${className}`} />
  );
}

interface EpicChipProps {
  /** A task's `epicId` (populated or bare id) or an epic object. */
  epic: ITask['epicId'] | EpicRef;
  /** Used to resolve a bare id. */
  epics?: EpicRef[];
  className?: string;
}

/** Small tinted "● Epic name" label for cards and rows; renders nothing without an epic. */
export function EpicChip({ epic, epics, className = '' }: EpicChipProps) {
  const ref = resolveEpic(epic as ITask['epicId'], epics);
  if (!ref) return null;
  const done = ref.status === EpicStatus.DONE;
  return (
    <span
      title={`Epic: ${ref.title}${done ? ' (done)' : ''}`}
      className={`inline-flex h-5 min-w-0 ${className.includes('max-w-') ? '' : 'max-w-[10rem]'} items-center gap-1 rounded px-1.5 text-[11px] font-semibold leading-none ${
        epicColorClasses(ref.color).chip
      } ${done ? 'opacity-70' : ''} ${className}`}
    >
      <EpicDot color={ref.color} className="h-1.5 w-1.5" />
      <span className="sr-only">Epic: </span>
      <span className="truncate">{ref.title}</span>
    </span>
  );
}
