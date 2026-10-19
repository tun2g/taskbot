import type { IGroupSummary } from '@tbot/shared';
import { TaskStatusCategory } from '@tbot/shared';

import type { BoardSearch } from '../../tasks/board-search';

interface GroupCardProps {
  group: IGroupSummary;
  onOpen: (groupId: string, search?: BoardSearch) => void;
}

/** Group summary. Every number opens the board filtered to exactly those tasks. */
export function GroupCard({ group, onOpen }: GroupCardProps) {
  const { counts, mine } = group;
  const name = group.groupName || 'Untitled group';
  return (
    <section className="flex w-full flex-col rounded-lg border border-tg-separator bg-tg-section" aria-label={name}>
      <button
        type="button"
        onClick={() => onOpen(group._id)}
        className="flex min-h-12 w-full items-center justify-between gap-2 rounded-t-lg px-4 pt-3 pb-2 text-left transition-colors hover:bg-tg-secondary/50 active:bg-tg-secondary"
      >
        <h2 className="truncate text-base font-semibold text-tg-text">{name}</h2>
        <span className="flex shrink-0 items-center gap-1 text-sm text-tg-link">
          Open board <span aria-hidden>›</span>
        </span>
      </button>
      <div className="grid w-full grid-cols-3 gap-2 px-4">
        <Count
          label="To do"
          value={counts.todo}
          lozenge="lozenge-todo"
          onClick={() => onOpen(group._id, { view: 'list', category: TaskStatusCategory.TODO })}
        />
        <Count
          label="In progress"
          value={counts.in_progress}
          lozenge="lozenge-in_progress"
          onClick={() => onOpen(group._id, { view: 'list', category: TaskStatusCategory.IN_PROGRESS })}
        />
        <Count
          label="Done"
          value={counts.done}
          lozenge="lozenge-done"
          onClick={() => onOpen(group._id, { view: 'list', category: TaskStatusCategory.DONE })}
        />
      </div>
      {mine > 0 ? (
        <button
          type="button"
          onClick={() => onOpen(group._id, { view: 'list', assignee: 'me', category: 'open', sort: 'due', dir: 'asc' })}
          className="mx-2 my-1 flex min-h-11 items-center gap-1 rounded-md px-2 text-left text-sm font-medium text-tg-link transition-colors hover:bg-tg-secondary/60"
        >
          {mine} open assigned to you <span aria-hidden>›</span>
        </button>
      ) : (
        <p className="flex min-h-11 items-center px-4 pb-1 text-sm text-tg-hint">Nothing assigned to you</p>
      )}
    </section>
  );
}

function Count({
  label,
  value,
  lozenge,
  onClick,
}: {
  label: string;
  value: number;
  lozenge: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${value} ${label} — show them`}
      className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-md bg-tg-secondary px-2 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--tg-theme-link-color)_10%,var(--tg-theme-secondary-bg-color))]"
    >
      <span className="text-lg font-semibold leading-none text-tg-text">{value}</span>
      <span className={`lozenge ${lozenge}`}>{label}</span>
    </button>
  );
}
