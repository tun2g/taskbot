import type { IGroupSummary } from '@tbot/shared';
import { TaskStatusCategory } from '@tbot/shared';

import { groupUnavailableInfo, isGroupUsable } from '@/lib/group-status';

import type { BoardSearch } from '../../tasks/board-search';

interface GroupCardProps {
  group: IGroupSummary;
  onOpen: (groupId: string, search?: BoardSearch) => void;
}

/** Group summary. Every number opens the board filtered to exactly those tasks. */
export function GroupCard({ group, onOpen }: GroupCardProps) {
  const { counts, mine } = group;
  const overdue = group.overdue ?? 0;
  const name = group.groupName || 'Untitled group';
  if (!isGroupUsable(group)) return <UnavailableGroupCard name={name} group={group} />;
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
      {overdue > 0 && (
        <button
          type="button"
          onClick={() => onOpen(group._id, { view: 'list', due: 'overdue', sort: 'due', dir: 'asc' })}
          className="mx-2 mt-2 flex min-h-11 items-center gap-1 rounded-md px-2 text-left text-sm font-medium text-tg-destructive transition-colors hover:bg-tg-secondary/60"
        >
          <span aria-hidden>⚠️</span> {overdue} overdue <span aria-hidden>›</span>
        </button>
      )}
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

/** Waiting for approval / paused / bot removed: not clickable, says why. */
function UnavailableGroupCard({ name, group }: { name: string; group: IGroupSummary }) {
  const { badge, text } = groupUnavailableInfo(group);
  return (
    <section
      className="flex w-full flex-col gap-2 rounded-lg border border-tg-separator bg-tg-section px-4 py-3"
      aria-label={`${name} — ${badge}`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="truncate text-base font-semibold text-tg-hint">{name}</h2>
        <span className="lozenge lozenge-pending shrink-0">{badge}</span>
      </div>
      <p className="text-sm text-tg-hint">{text}</p>
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
