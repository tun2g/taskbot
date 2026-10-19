import type { TaskStatus } from '@tbot/shared';

import { dueLabel, dueState } from '@/lib/dates';

const classes = {
  overdue: 'tint-danger font-semibold',
  today: 'tint-link font-semibold',
  upcoming: 'tint-neutral',
  none: '',
};

export function DueChip({ dueDate, timeZone, status }: { dueDate?: string | null; timeZone?: string | null; status: TaskStatus }) {
  const state = dueState(dueDate, timeZone, status);
  if (state === 'none') return null;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-[11px] ${classes[state]}`}>
      <span aria-hidden>📅</span>
      {dueLabel(dueDate, timeZone, status)}
    </span>
  );
}
