import type { IUser, UserRef } from '@tbot/shared';

import { Avatar } from '@/components/ui/badges';
import { SelectMenu } from '@/components/ui/select-menu';
import { displayName, getUserId, resolveUser } from '@/lib/user';

interface AssigneePickerProps {
  id: string;
  members: IUser[];
  assignee?: UserRef | null;
  onSelect: (userId: string | null) => void;
  disabled?: boolean;
  /** `input` = bordered form field (create modal); `ghost` = detail panel. */
  appearance?: 'ghost' | 'input';
}

export function AssigneePicker({
  id,
  members,
  assignee,
  onSelect,
  disabled,
  appearance = 'ghost',
}: AssigneePickerProps) {
  const currentId = getUserId(assignee) ?? null;
  const current = resolveUser(assignee, members);
  // Keep a former member (left the group) selectable so the picker shows them.
  const people = current && !members.some((m) => m._id === current._id) ? [current, ...members] : members;

  return (
    <SelectMenu<string>
      id={id}
      variant="field"
      appearance={appearance}
      title="Assignee"
      value={currentId}
      onChange={onSelect}
      disabled={disabled}
      clearOption={{ label: 'Unassigned', icon: <Avatar user={null} /> }}
      options={people.map((m) => ({
        value: m._id,
        label: displayName(m),
        icon: <Avatar user={m} members={members} />,
        hint: m.username ? `@${m.username}` : undefined,
      }))}
      searchPlaceholder="Search people"
    />
  );
}
