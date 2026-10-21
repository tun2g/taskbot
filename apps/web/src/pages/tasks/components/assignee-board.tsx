import type { ITask, IUser } from '@tbot/shared';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/badges';
import { Checkbox } from '@/components/ui/checkbox';
import { displayName, getUserId, resolveUser } from '@/lib/user';

import type { BoardSearch } from '../board-search';
import { type KanbanColumn, KanbanBoard } from './kanban-board';

const UNASSIGNED = '__unassigned';

interface AssigneeBoardProps {
  tasks: ITask[];
  members: IUser[];
  search: BoardSearch;
  /** Server totals per assignee id (`"none"` = unassigned) for the same filters; null while loading. */
  assigneeCounts: Record<string, number> | null;
  /** More pages on the server — the loaded tasks aren't everyone's. */
  hasMore: boolean;
  onSearchChange: (patch: Partial<BoardSearch>, options?: { replace?: boolean }) => void;
  onAssigneeChange: (task: ITask, assigneeId: string | null) => void;
  renderCard: (task: ITask, isOverlay?: boolean) => ReactNode;
  footer?: ReactNode;
}

/** "3 more not loaded yet" — a column whose cards are all on later pages must not look empty. */
function notLoadedText(count: number) {
  return `${count} task${count === 1 ? '' : 's'} not loaded yet — load more below`;
}

/**
 * Assignee board: one paged list (all statuses) grouped client-side; "Load more" sits under the board.
 * Column counts and "who has nothing" come from the server totals, not from the pages loaded so far.
 */
export function AssigneeBoard({
  tasks,
  members,
  search,
  assigneeCounts,
  hasMore,
  onSearchChange,
  onAssigneeChange,
  renderCard,
  footer,
}: AssigneeBoardProps) {
  const byAssignee = new Map<string, ITask[]>();
  const users = new Map<string, IUser | null>();
  for (const task of tasks) {
    const id = getUserId(task.assigneeId) ?? UNASSIGNED;
    if (!byAssignee.has(id)) byAssignee.set(id, []);
    byAssignee.get(id)!.push(task);
    if (id !== UNASSIGNED && !users.has(id)) users.set(id, resolveUser(task.assigneeId, members));
  }

  const loaded = (id: string) => byAssignee.get(id)?.length ?? 0;
  /** Server total when known, else what's loaded (a lower bound while more pages exist). */
  const countOf = (id: string): number => {
    const key = id === UNASSIGNED ? 'none' : id;
    return assigneeCounts ? (assigneeCounts[key] ?? 0) : loaded(id);
  };
  const countsKnown = !!assigneeCounts || !hasMore;

  const withTasks = new Set([...byAssignee.keys()].filter((id) => id !== UNASSIGNED));
  for (const [id, n] of Object.entries(assigneeCounts ?? {})) if (id !== 'none' && n > 0) withTasks.add(id);
  // Only claim "no tasks" once the totals are known.
  const idle = countsKnown ? members.filter((m) => !withTasks.has(m._id)) : [];
  const showEveryone = !!search.everyone;

  const nameOf = (id: string) => displayName(users.get(id) ?? members.find((m) => m._id === id) ?? id, { members });
  const sortedWithTasks = [...withTasks].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const emptyText = (id: string, fallback: string) => {
    const missing = countOf(id) - loaded(id);
    if (missing > 0) return notLoadedText(missing);
    return countsKnown ? fallback : 'Load more below to see the rest';
  };

  const columns: KanbanColumn[] = [
    {
      id: UNASSIGNED,
      title: (
        <>
          <Avatar user={null} /> Unassigned
        </>
      ),
      label: 'Unassigned',
      count: countsKnown ? countOf(UNASSIGNED) : null,
      tasks: byAssignee.get(UNASSIGNED) ?? [],
      emptyText: emptyText(UNASSIGNED, 'Everything is assigned'),
    },
    ...sortedWithTasks.map((id) => ({
      id,
      title: (
        <>
          <Avatar user={users.get(id) ?? id} members={members} /> <span className="truncate">{nameOf(id)}</span>
        </>
      ),
      label: nameOf(id),
      count: countsKnown ? countOf(id) : null,
      tasks: byAssignee.get(id) ?? [],
      emptyText: emptyText(id, 'Drag a card here to assign'),
    })),
    ...(showEveryone
      ? idle.map((m) => ({
          id: m._id,
          title: (
            <>
              <Avatar user={m} /> <span className="truncate">{displayName(m)}</span>
            </>
          ),
          label: displayName(m),
          count: 0,
          tasks: [],
          emptyText: 'Drag a card here to assign',
        }))
      : []),
  ];

  return (
    <>
      {idle.length > 0 && (
        <div className="flex items-center justify-end px-4 pt-2">
          <Checkbox
            checked={showEveryone}
            onChange={(v) => onSearchChange({ everyone: v || undefined }, { replace: true })}
          >
            Show everyone ({idle.length} with no tasks)
          </Checkbox>
        </div>
      )}
      <KanbanBoard
        columns={columns}
        renderCard={(task, { isOverlay }) => renderCard(task, isOverlay)}
        onMove={(task, _from, to) => onAssigneeChange(task, to === UNASSIGNED ? null : to)}
        footer={footer}
      />
    </>
  );
}
