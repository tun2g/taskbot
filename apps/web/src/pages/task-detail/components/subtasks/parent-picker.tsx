import type { ITask } from '@tbot/shared';
import { type ReactNode, useMemo, useState } from 'react';

import { isParentFull, useParentCandidates } from '@/api/subtasks';
import { TypeIcon } from '@/components/ui/badges';
import { SelectMenu, type SelectOption } from '@/components/ui/select-menu';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { getErrorMessage } from '@/lib/api-client';
import { getEpicId, resolveEpic } from '@/lib/epics';
import { getParentId } from '@/lib/subtasks';

interface ParentPickerProps {
  id?: string;
  groupId: string;
  /** The task being moved. */
  task: ITask;
  title?: string;
  /** field: the "Parent" field look; custom: your own trigger (`children`). */
  variant?: 'field' | 'custom';
  /** field: `ghost` (details panel) or `input` (inside a dialog). */
  appearance?: 'ghost' | 'input';
  placeholder?: string;
  triggerClassName?: string;
  triggerLabel?: string;
  children?: ReactNode;
  onPick: (parent: ITask) => void;
}

/** "Moves it to epic “Login”" — joining a parent moves the task into the parent's epic. */
function epicHint(task: ITask, candidate: ITask): string | undefined {
  const from = getEpicId(task.epicId);
  const to = getEpicId(candidate.epicId);
  if (from === to) return undefined;
  const target = resolveEpic(candidate.epicId);
  if (to) return `Moves it to epic “${target?.title ?? 'its epic'}”`;
  return 'Takes it out of its epic';
}

/**
 * Picks a task to be this task's parent. Loads only once opened, searches on the server (title or #number), and
 * offers open top-level tasks only — never the task itself, its current parent, or a parent that is full.
 */
export function ParentPicker({
  id,
  groupId,
  task,
  title = 'Make it a subtask of',
  variant = 'field',
  appearance = 'ghost',
  placeholder = 'None',
  triggerClassName,
  triggerLabel,
  children,
  onPick,
}: ParentPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query, 250);
  const candidates = useParentCandidates(groupId, search, { enabled: open });
  const currentParentId = getParentId(task);

  const options = useMemo<SelectOption<string>[]>(
    () =>
      (candidates.data ?? [])
        .filter((t) => t._id !== task._id && t._id !== currentParentId && !isParentFull(t))
        .map((t) => ({
          value: t._id,
          label: `#${t.taskNumber} ${t.title}`,
          icon: <TypeIcon type={t.type} />,
          hint: epicHint(task, t),
        })),
    [candidates.data, task, currentParentId],
  );

  return (
    <SelectMenu<string>
      id={id}
      variant={variant}
      appearance={appearance}
      title={title}
      placeholder={placeholder}
      value={null}
      onChange={(value) => {
        const next = candidates.data?.find((t) => t._id === value);
        if (next) onPick(next);
      }}
      options={options}
      searchable
      searchPlaceholder="Search open tasks by title or #number"
      onOpenChange={setOpen}
      onSearchChange={setQuery}
      loading={candidates.isFetching && options.length === 0}
      loadError={candidates.isError ? `Couldn't load tasks: ${getErrorMessage(candidates.error)}` : null}
      onRetry={() => void candidates.refetch()}
      emptyText={search ? 'No open task matches' : 'No open tasks to pick'}
      menuWidth={340}
      triggerClassName={triggerClassName}
      triggerLabel={triggerLabel}
    >
      {children}
    </SelectMenu>
  );
}
