import type { ITask, IUser } from '@tbot/shared';
import { TaskStatus } from '@tbot/shared';
import type { ReactNode } from 'react';

import { EpicChip } from '@/components/epics/epic-chip';
import { Avatar, PriorityIcon, StatusLozenge, TypeIcon } from '@/components/ui/badges';
import { type SelectOption, SelectMenu } from '@/components/ui/select-menu';
import type { EpicRef } from '@/lib/epics';
import { displayName, getUserId } from '@/lib/user';

import type { ListSortKey } from '../board-search';
import { DueChip } from './due-chip';
import { StatusMenu } from './status-menu';

interface TaskListProps {
  tasks: ITask[];
  members: IUser[];
  epics?: EpicRef[];
  /** List already filtered to one epic → skip the chip. */
  hideEpic?: boolean;
  timeZone?: string | null;
  sort?: ListSortKey;
  dir?: 'asc' | 'desc';
  onSortChange: (sort: ListSortKey | undefined, dir: 'asc' | 'desc' | undefined) => void;
  onTaskClick: (task: ITask) => void;
  onStatusChange: (task: ITask, status: TaskStatus) => void;
  /** Under the rows, e.g. "Load more". */
  footer?: ReactNode;
}

const SORT_OPTIONS: SelectOption<string>[] = [
  { value: 'key:asc', label: 'Oldest first' },
  { value: 'priority:desc', label: 'Priority (highest)' },
  { value: 'due:asc', label: 'Due date (soonest)' },
  { value: 'status:asc', label: 'Status' },
  { value: 'assignee:asc', label: 'Assignee' },
  { value: 'summary:asc', label: 'Summary (A–Z)' },
];

const COLUMNS: { key: ListSortKey; label: string; className: string }[] = [
  { key: 'type', label: 'Type', className: 'w-14' },
  { key: 'key', label: 'Key', className: 'w-16' },
  { key: 'summary', label: 'Summary', className: '' },
  { key: 'status', label: 'Status', className: 'w-32' },
  { key: 'priority', label: 'Priority', className: 'w-28' },
  { key: 'assignee', label: 'Assignee', className: 'w-44' },
  { key: 'due', label: 'Due', className: 'w-36' },
];

export function TaskList({
  tasks,
  members,
  epics,
  hideEpic,
  timeZone,
  sort,
  dir,
  onSortChange,
  onTaskClick,
  onStatusChange,
  footer,
}: TaskListProps) {
  // Sorted by the server (sort/dir are query params), so paging stays in order.
  const rows = tasks;

  // asc → desc → default (server order)
  const cycleSort = (key: ListSortKey) => {
    if (sort !== key) onSortChange(key, 'asc');
    else if ((dir ?? 'asc') === 'asc') onSortChange(key, 'desc');
    else onSortChange(undefined, undefined);
  };

  return (
    <div className="px-4 pb-4 pt-2">
      {/* Desktop: Jira-like table */}
      <table className="hidden w-full table-fixed border-collapse text-sm md:table">
        <thead>
          <tr className="border-b-2 border-tg-separator text-left">
            {COLUMNS.map((c) => {
              const active = sort === c.key;
              return (
                <th
                  key={c.key}
                  className={`${c.className} p-0 font-semibold`}
                  aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => cycleSort(c.key)}
                    className={`flex min-h-11 w-full items-center gap-1 px-2 text-xs uppercase tracking-wide ${
                      active ? 'text-tg-text' : 'text-tg-hint hover:text-tg-text'
                    }`}
                  >
                    {c.label}
                    <span aria-hidden className="text-[10px]">
                      {active ? (dir === 'desc' ? '▼' : '▲') : ''}
                    </span>
                  </button>
                </th>
              );
            })}
            <th className="w-12 p-0">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((task) => (
            <tr
              key={task._id}
              onClick={() => onTaskClick(task)}
              className="cursor-pointer border-b border-tg-separator hover:bg-tg-secondary/60"
            >
              <td className="px-2 py-1.5">
                <TypeIcon type={task.type} />
              </td>
              <td className="px-2 py-1.5 font-mono text-xs text-tg-hint">#{task.taskNumber}</td>
              <td className="px-2 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTaskClick(task);
                    }}
                    title={task.title}
                    className="block min-w-0 truncate text-left text-tg-text hover:text-tg-link hover:underline"
                  >
                    {task.title}
                  </button>
                  {!hideEpic && <EpicChip epic={task.epicId} epics={epics} className="max-w-[7.5rem]" />}
                </span>
              </td>
              <td className="px-2 py-1.5">
                <StatusLozenge status={task.status} />
              </td>
              <td className="px-2 py-1.5 text-xs text-tg-text">
                <PriorityIcon priority={task.priority} withLabel />
              </td>
              <td className="px-2 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar user={task.assigneeId} members={members} />
                  <span className={`truncate text-xs ${getUserId(task.assigneeId) ? 'text-tg-text' : 'text-tg-hint'}`}>
                    {displayName(task.assigneeId, { members })}
                  </span>
                </span>
              </td>
              <td className="px-2 py-1.5">
                <DueChip dueDate={task.dueDate} timeZone={timeZone} status={task.status} />
              </td>
              <td className="py-0.5">
                <StatusMenu task={task} onChange={onStatusChange} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: compact rows */}
      <div className="md:hidden">
        <div className="mb-1 flex items-center justify-end gap-1 text-xs text-tg-hint">
          <span>Sort</span>
          <SelectMenu<string>
            variant="custom"
            title="Sort by"
            value={sort ? `${sort}:${dir ?? 'asc'}` : null}
            onChange={(v) => {
              const [k, d] = (v ?? '').split(':');
              onSortChange((k || undefined) as ListSortKey | undefined, (d || undefined) as 'asc' | 'desc' | undefined);
            }}
            clearOption={{ label: 'Newest first' }}
            options={SORT_OPTIONS}
            align="end"
            triggerClassName="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-tg-text hover:bg-tg-secondary"
          >
            {SORT_OPTIONS.find((o) => o.value === `${sort}:${dir ?? 'asc'}`)?.label ?? 'Newest first'}
            <span aria-hidden className="text-[10px] text-tg-hint">
              ▼
            </span>
          </SelectMenu>
        </div>
        <ul className="divide-y divide-tg-separator border-y border-tg-separator">
          {rows.map((task) => (
            <li key={task._id} className="flex items-start gap-1">
              <button
                type="button"
                onClick={() => onTaskClick(task)}
                className="min-w-0 flex-1 py-2.5 pl-1 text-left transition-colors active:bg-tg-secondary"
              >
                <span className="line-clamp-2 text-sm leading-snug text-tg-text [overflow-wrap:anywhere]">
                  <span className="mr-1.5 inline-flex items-center gap-1 align-[1px]">
                    <TypeIcon type={task.type} />
                    <span className="font-mono text-xs text-tg-hint">#{task.taskNumber}</span>
                  </span>
                  {task.title}
                </span>
                <span className="mt-1.5 flex items-center gap-2">
                  <StatusLozenge status={task.status} />
                  <PriorityIcon priority={task.priority} />
                  <DueChip dueDate={task.dueDate} timeZone={timeZone} status={task.status} />
                  {!hideEpic && <EpicChip epic={task.epicId} epics={epics} />}
                  <span className="ml-auto shrink-0">
                    <Avatar user={task.assigneeId} members={members} />
                  </span>
                </span>
              </button>
              <StatusMenu task={task} onChange={onStatusChange} />
            </li>
          ))}
        </ul>
      </div>
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}
