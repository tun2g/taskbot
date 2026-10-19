import type { ITask, IUser } from '@tbot/shared';
import { TASK_PRIORITY_ORDER, TASK_STATUS_ORDER, TASK_TYPE_ORDER, TaskStatus } from '@tbot/shared';
import { useMemo } from 'react';

import { Avatar, PriorityIcon, StatusLozenge, TypeIcon } from '@/components/ui/badges';
import { toDueDay } from '@/lib/dates';
import { displayName, getUserId } from '@/lib/user';

import type { ListSortKey } from '../board-search';
import { DueChip } from './due-chip';
import { StatusMenu } from './status-menu';

interface TaskListProps {
  tasks: ITask[];
  members: IUser[];
  timeZone?: string | null;
  sort?: ListSortKey;
  dir?: 'asc' | 'desc';
  onSortChange: (sort: ListSortKey | undefined, dir: 'asc' | 'desc' | undefined) => void;
  onTaskClick: (task: ITask) => void;
  onStatusChange: (task: ITask, status: TaskStatus) => void;
}

const COLUMNS: { key: ListSortKey; label: string; className: string }[] = [
  { key: 'type', label: 'Type', className: 'w-14' },
  { key: 'key', label: 'Key', className: 'w-16' },
  { key: 'summary', label: 'Summary', className: '' },
  { key: 'status', label: 'Status', className: 'w-32' },
  { key: 'priority', label: 'Priority', className: 'w-28' },
  { key: 'assignee', label: 'Assignee', className: 'w-44' },
  { key: 'due', label: 'Due', className: 'w-36' },
];

function sortTasks(tasks: ITask[], members: IUser[], sort?: ListSortKey, dir: 'asc' | 'desc' = 'asc') {
  if (!sort) return tasks;
  const factor = dir === 'asc' ? 1 : -1;
  const value = (t: ITask): string | number | null => {
    switch (sort) {
      case 'type':
        return TASK_TYPE_ORDER.indexOf(t.type);
      case 'key':
        return t.taskNumber;
      case 'summary':
        return t.title.toLocaleLowerCase();
      case 'status':
        return TASK_STATUS_ORDER.indexOf(t.status);
      case 'priority':
        return TASK_PRIORITY_ORDER.indexOf(t.priority);
      case 'assignee':
        return getUserId(t.assigneeId) ? displayName(t.assigneeId, { members }).toLocaleLowerCase() : null;
      case 'due':
        return toDueDay(t.dueDate);
    }
  };
  return [...tasks].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === vb) return b.taskNumber - a.taskNumber;
    if (va === null) return 1; // empty values always last
    if (vb === null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
    return String(va).localeCompare(String(vb)) * factor;
  });
}

export function TaskList({ tasks, members, timeZone, sort, dir, onSortChange, onTaskClick, onStatusChange }: TaskListProps) {
  const rows = useMemo(() => sortTasks(tasks, members, sort, dir), [tasks, members, sort, dir]);

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
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTaskClick(task);
                  }}
                  className="block w-full truncate text-left text-tg-text hover:text-tg-link hover:underline"
                >
                  {task.title}
                </button>
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
        <label className="mb-1 flex items-center justify-end gap-2 text-xs text-tg-hint">
          Sort
          <select
            value={sort ? `${sort}:${dir ?? 'asc'}` : ''}
            onChange={(e) => {
              const [k, d] = e.target.value.split(':');
              onSortChange((k || undefined) as ListSortKey | undefined, (d || undefined) as 'asc' | 'desc' | undefined);
            }}
            className="min-h-11 rounded-lg bg-transparent px-1 text-sm font-medium text-tg-text"
          >
            <option value="">Newest first</option>
            <option value="key:asc">Oldest first</option>
            <option value="priority:desc">Priority (highest)</option>
            <option value="due:asc">Due date (soonest)</option>
            <option value="status:asc">Status</option>
            <option value="assignee:asc">Assignee</option>
            <option value="summary:asc">Summary (A–Z)</option>
          </select>
        </label>
        <ul className="divide-y divide-tg-separator border-y border-tg-separator">
          {rows.map((task) => (
            <li key={task._id} className="flex items-start gap-1">
              <button type="button" onClick={() => onTaskClick(task)} className="min-w-0 flex-1 py-2.5 text-left active:bg-tg-secondary">
                <span className="flex items-center gap-2">
                  <TypeIcon type={task.type} />
                  <span className="font-mono text-xs text-tg-hint">#{task.taskNumber}</span>
                  <span className="truncate text-sm text-tg-text">{task.title}</span>
                </span>
                <span className="mt-1.5 flex items-center gap-2">
                  <StatusLozenge status={task.status} />
                  <PriorityIcon priority={task.priority} />
                  <DueChip dueDate={task.dueDate} timeZone={timeZone} status={task.status} />
                  <span className="ml-auto">
                    <Avatar user={task.assigneeId} members={members} />
                  </span>
                </span>
              </button>
              <StatusMenu task={task} onChange={onStatusChange} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
