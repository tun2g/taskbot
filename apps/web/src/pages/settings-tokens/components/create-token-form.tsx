import type { IGroupSummary } from '@tbot/shared';
import { type FormEvent, useId, useState } from 'react';

import type { CreateApiTokenInput } from '@/api/tokens';
import { Button } from '@/components/ui/button';
import { ErrorBox, FormField, Input } from '@/components/ui/input';
import { SelectMenu, type SelectOption } from '@/components/ui/select-menu';

const DEFAULT_NAME = 'My laptop';
/** "Works in" value for an all-groups token. */
const ALL_GROUPS = '__all__';

interface CreateTokenFormProps {
  groups: IGroupSummary[];
  groupsLoading: boolean;
  /** ?group=<id> — preselected when it's one of the user's groups. */
  preferredGroupId?: string;
  onCreate: (input: CreateApiTokenInput) => Promise<boolean>;
  isCreating: boolean;
  /** Server error (incl. the 409 "too many tokens" message). */
  error: string | null;
  /** Already at the limit: the form is disabled with this explanation. */
  limitMessage: string | null;
}

export function CreateTokenForm({
  groups,
  groupsLoading,
  preferredGroupId,
  onCreate,
  isCreating,
  error,
  limitMessage,
}: CreateTokenFormProps) {
  const nameId = useId();
  const scopeId = useId();
  const [name, setName] = useState(DEFAULT_NAME);
  // null until the user picks — the default follows the groups list as it loads.
  const [picked, setPicked] = useState<string | null>(null);
  const trimmed = name.trim();

  const defaultScope =
    (preferredGroupId && groups.some((g) => g._id === preferredGroupId) && preferredGroupId) ||
    groups[0]?._id ||
    ALL_GROUPS;
  const scope = picked && (picked === ALL_GROUPS || groups.some((g) => g._id === picked)) ? picked : defaultScope;

  const options: SelectOption[] = [
    ...groups.map((g) => ({ value: g._id, label: g.groupName, icon: '👥' })),
    { value: ALL_GROUPS, label: 'All my groups', icon: '🌐', hint: 'Including groups you join later' },
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || isCreating || limitMessage || groupsLoading) return;
    const ok = await onCreate({ name: trimmed, groupId: scope === ALL_GROUPS ? null : scope });
    if (ok) setName(DEFAULT_NAME);
  };

  return (
    <form onSubmit={submit} className="space-y-4 p-4">
      <FormField label="Token name" htmlFor={nameId} hint="Where you'll use it, so you can tell tokens apart later.">
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          autoComplete="off"
          enterKeyHint="done"
          disabled={!!limitMessage}
        />
      </FormField>
      <FormField
        label="Works in"
        htmlFor={scopeId}
        hint={
          scope === ALL_GROUPS
            ? 'The AI tool can read and change tasks in every group you belong to.'
            : 'The AI tool can only see and change tasks in this group.'
        }
      >
        <SelectMenu
          id={scopeId}
          variant="field"
          appearance="input"
          title="Works in"
          value={scope}
          onChange={(v) => v && setPicked(v)}
          options={options}
          placeholder={groupsLoading ? 'Loading groups…' : undefined}
          disabled={!!limitMessage || groupsLoading}
          menuWidth={300}
        />
      </FormField>
      {(limitMessage || error) && <ErrorBox>{limitMessage ?? error}</ErrorBox>}
      <Button
        type="submit"
        variant="primary"
        className="w-full sm:w-auto"
        disabled={!trimmed || !!limitMessage || groupsLoading}
        loading={isCreating}
        loadingText="Creating…"
      >
        Create token
      </Button>
    </form>
  );
}
