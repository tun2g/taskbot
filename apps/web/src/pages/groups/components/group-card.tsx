import type { IGroupSummary } from '@tbot/shared';

interface GroupCardProps {
  group: IGroupSummary;
  onOpen: (groupId: string) => void;
}

export function GroupCard({ group, onOpen }: GroupCardProps) {
  const { counts, mine } = group;
  return (
    <button
      type="button"
      onClick={() => onOpen(group._id)}
      className="flex w-full flex-col gap-3 rounded-lg border border-tg-separator bg-tg-section p-4 text-left transition-shadow hover:shadow-md active:bg-tg-secondary"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <h2 className="truncate text-base font-semibold text-tg-text">{group.groupName || 'Untitled group'}</h2>
        <span className="text-tg-hint" aria-hidden>›</span>
      </div>
      <dl className="grid w-full grid-cols-3 gap-2 text-center">
        <Count label="To do" value={counts.todo} lozenge="lozenge-todo" />
        <Count label="In progress" value={counts.in_progress} lozenge="lozenge-in_progress" />
        <Count label="Done" value={counts.done} lozenge="lozenge-done" />
      </dl>
      <p className={`text-sm ${mine > 0 ? 'font-medium text-tg-link' : 'text-tg-hint'}`}>
        {mine > 0 ? `${mine} assigned to you` : 'Nothing assigned to you'}
      </p>
    </button>
  );
}

function Count({ label, value, lozenge }: { label: string; value: number; lozenge: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md bg-tg-secondary px-2 py-2">
      <dd className="text-lg font-semibold text-tg-text">{value}</dd>
      <dt className={`lozenge ${lozenge}`}>{label}</dt>
    </div>
  );
}
