import type { IUser, UserRef } from '@tbot/shared';

import { Avatar } from '@/components/ui/badges';
import { displayName, getUserId, resolveUser } from '@/lib/user';

interface AssigneePickerProps {
  id: string;
  members: IUser[];
  assignee?: UserRef | null;
  onSelect: (userId: string | null) => void;
  disabled?: boolean;
}

export function AssigneePicker({ id, members, assignee, onSelect, disabled }: AssigneePickerProps) {
  const currentId = getUserId(assignee) ?? '';
  const current = resolveUser(assignee, members);
  // Keep a former member (left the group) selectable so the select shows them.
  const options = current && !members.some((m) => m._id === current._id) ? [current, ...members] : members;

  return (
    <div className="-mx-2 flex min-h-11 items-center gap-2 rounded-md px-2 focus-within:ring-2 focus-within:ring-tg-link hover:bg-tg-secondary">
      <Avatar user={assignee} members={members} />
      <select
        id={id}
        value={currentId}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.value || null)}
        className="min-h-11 min-w-0 flex-1 cursor-pointer bg-transparent text-sm text-tg-text outline-none"
      >
        <option value="">Unassigned</option>
        {options.map((m) => (
          <option key={m._id} value={m._id}>
            {displayName(m)}
          </option>
        ))}
      </select>
    </div>
  );
}
