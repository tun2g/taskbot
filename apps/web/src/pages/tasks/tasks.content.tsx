import type { CreateTaskInput, ITask, IUser, TaskStatus } from '@tbot/shared';
import { TASK_BOARD_DEFAULT_STATUSES, TASK_STATUS_LABELS, TASK_STATUS_ORDER } from '@tbot/shared';
import type { ReactNode } from 'react';

import { AiChatPanel } from '@/components/ai-chat/ai-chat-panel';
import { AskAiButton, useAskAi } from '@/components/ai-chat/ask-ai';
import { Layout } from '@/components/layout/layout';
import { Avatar, statusText } from '@/components/ui/badges';
import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/ui/state';
import { displayName, getUserId, resolveUser } from '@/lib/user';

import type { BoardGroupBy, BoardSearch, BoardView } from './board-search';
import { CreateTaskModal } from './components/create-task-modal';
import { type KanbanColumn, KanbanBoard } from './components/kanban-board';
import { TaskCard } from './components/task-card';
import { TaskFiltersBar } from './components/task-filters';
import { TaskList } from './components/task-list';

const UNASSIGNED = '__unassigned';

interface TasksContentProps {
  groupId: string;
  groupName?: string;
  timeZone?: string | null;
  accessError: string | null;
  search: BoardSearch;
  view: BoardView;
  groupBy: BoardGroupBy;
  members: IUser[];
  tasks: ITask[];
  total: number;
  isLoading: boolean;
  isRefetching: boolean;
  error: string | null;
  onRetry: () => void;
  hasActiveFilters: boolean;
  onSearchChange: (patch: Partial<BoardSearch>, options?: { replace?: boolean }) => void;
  onClearFilters: () => void;
  onBack: () => void;
  onTaskClick: (task: ITask) => void;
  onStatusChange: (task: ITask, status: TaskStatus) => void;
  onAssigneeChange: (task: ITask, assigneeId: string | null) => void;
  showCreateModal: boolean;
  onShowCreateModal: (show: boolean) => void;
  onCreateTask: (input: CreateTaskInput) => Promise<string | null>;
  isCreating?: boolean;
}

export function TasksContent(props: TasksContentProps) {
  const {
    groupId,
    groupName,
    timeZone,
    accessError,
    search,
    view,
    groupBy,
    members,
    tasks,
    total,
    isLoading,
    error,
    onRetry,
    isRefetching,
    hasActiveFilters,
    onSearchChange,
    onClearFilters,
    onBack,
    onTaskClick,
    onStatusChange,
    showCreateModal,
    onShowCreateModal,
    onCreateTask,
    isCreating,
  } = props;
  const ai = useAskAi();

  if (accessError) {
    return (
      <Layout title="Task board" onBack={onBack}>
        <StateMessage
          icon="🔒"
          title="Can't open this board"
          body={accessError}
          action={
            <button type="button" onClick={onBack} className={buttonPrimary}>
              Back to your groups
            </button>
          }
        />
      </Layout>
    );
  }

  const renderCard = (task: ITask, isOverlay = false) => (
    <TaskCard
      task={task}
      members={members}
      timeZone={timeZone}
      showStatus={groupBy === 'assignee'}
      onClick={isOverlay ? undefined : onTaskClick}
      onStatusChange={isOverlay ? undefined : onStatusChange}
      isOverlay={isOverlay}
    />
  );

  let body: ReactNode;
  if (isLoading) {
    body = <BoardSkeleton view={view} />;
  } else if (error) {
    body = (
      <StateMessage
        icon="⚠️"
        title="Couldn't load tasks"
        body={error}
        action={
          <button type="button" onClick={onRetry} disabled={isRefetching} className={buttonPrimary}>
            {isRefetching ? 'Retrying…' : 'Retry'}
          </button>
        }
      />
    );
  } else if (tasks.length === 0 && hasActiveFilters) {
    body = (
      <StateMessage
        icon="🔍"
        title="No tasks match these filters"
        action={
          <button type="button" onClick={onClearFilters} className={buttonSecondary}>
            Clear filters
          </button>
        }
      />
    );
  } else if (tasks.length === 0) {
    body = (
      <StateMessage
        icon="📝"
        title="No tasks yet"
        body={
          <>
            Create one with <strong>+</strong> or send <code>/task …</code> in the group chat.
          </>
        }
      />
    );
  } else if (view === 'list') {
    body = (
      <TaskList
        tasks={tasks}
        members={members}
        timeZone={timeZone}
        sort={search.sort}
        dir={search.dir}
        onSortChange={(sort, dir) => onSearchChange({ sort, dir }, { replace: true })}
        onTaskClick={onTaskClick}
        onStatusChange={onStatusChange}
      />
    );
  } else if (groupBy === 'status') {
    body = <StatusBoard {...props} renderCard={renderCard} />;
  } else {
    body = <AssigneeBoard {...props} renderCard={renderCard} />;
  }

  return (
    <Layout
      width="wide"
      title={groupName ?? <Skeleton className="h-5 w-40" />}
      subtitle="Task board"
      onBack={ai.backHandler(onBack)}
      actions={<AskAiButton onClick={ai.open ? ai.close : ai.openChat} active={ai.open} />}
      fab={
        <button
          type="button"
          onClick={() => onShowCreateModal(true)}
          aria-label="New task"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-tg-button text-3xl text-tg-button-text shadow-lg transition-transform active:scale-95"
        >
          +
        </button>
      }
    >
      <TaskFiltersBar
        search={search}
        view={view}
        groupBy={groupBy}
        members={members}
        onChange={onSearchChange}
        onClear={onClearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {!isLoading && !error && total > tasks.length && (
        <p className="px-4 pt-3 text-xs text-tg-hint">
          Showing {tasks.length} of {total} tasks. Narrow the filters to see the rest.
        </p>
      )}

      <div className={isRefetching ? 'opacity-90 transition-opacity' : ''}>{body}</div>

      <CreateTaskModal
        isOpen={showCreateModal}
        members={members}
        onClose={() => onShowCreateModal(false)}
        onSubmit={onCreateTask}
        isLoading={isCreating}
      />

      <AiChatPanel groupId={groupId} open={ai.open} isDesktop={ai.isDesktop} onClose={ai.close} />
    </Layout>
  );
}

type BoardProps = TasksContentProps & { renderCard: (task: ITask, isOverlay?: boolean) => ReactNode };

function StatusBoard({ tasks, search, onSearchChange, onStatusChange, renderCard }: BoardProps) {
  const showAll = !!search.allStatuses;
  const visible = showAll ? TASK_STATUS_ORDER : TASK_BOARD_DEFAULT_STATUSES;
  const hiddenCount = showAll ? 0 : tasks.filter((t) => !visible.includes(t.status)).length;

  const columns: KanbanColumn[] = visible.map((status) => {
    const columnTasks = tasks.filter((t) => t.status === status);
    return {
      id: status,
      title: statusText(status),
      label: TASK_STATUS_LABELS[status],
      count: columnTasks.length,
      tasks: columnTasks,
    };
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2">
        <p className="text-xs text-tg-hint">
          {hiddenCount > 0
            ? `${hiddenCount} task${hiddenCount === 1 ? '' : 's'} in Backlog, Pending or Cancelled are hidden.`
            : 'Drag cards between columns, or use ⋯ on a card.'}
        </p>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-tg-text">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => onSearchChange({ allStatuses: e.target.checked || undefined }, { replace: true })}
            className="h-5 w-5 accent-[var(--tg-theme-button-color)]"
          />
          Show all statuses
        </label>
      </div>
      <KanbanBoard
        columns={columns}
        renderCard={(task, { isOverlay }) => renderCard(task, isOverlay)}
        onMove={(task, _from, to) => onStatusChange(task, to as TaskStatus)}
      />
    </>
  );
}

function AssigneeBoard({ tasks, members, search, onSearchChange, onAssigneeChange, renderCard }: BoardProps) {
  const byAssignee = new Map<string, ITask[]>();
  const users = new Map<string, IUser | null>();
  for (const task of tasks) {
    const id = getUserId(task.assigneeId) ?? UNASSIGNED;
    if (!byAssignee.has(id)) byAssignee.set(id, []);
    byAssignee.get(id)!.push(task);
    if (id !== UNASSIGNED && !users.has(id)) users.set(id, resolveUser(task.assigneeId, members));
  }

  const memberIdsWithTasks = [...byAssignee.keys()].filter((id) => id !== UNASSIGNED);
  const idle = members.filter((m) => !byAssignee.has(m._id));
  const showEveryone = !!search.everyone;

  const nameOf = (id: string) => displayName(users.get(id) ?? members.find((m) => m._id === id) ?? id, { members });
  const sortedWithTasks = memberIdsWithTasks.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const columns: KanbanColumn[] = [
    {
      id: UNASSIGNED,
      title: (
        <>
          <Avatar user={null} /> Unassigned
        </>
      ),
      label: 'Unassigned',
      count: byAssignee.get(UNASSIGNED)?.length ?? 0,
      tasks: byAssignee.get(UNASSIGNED) ?? [],
      emptyText: 'Everything is assigned',
    },
    ...sortedWithTasks.map((id) => ({
      id,
      title: (
        <>
          <Avatar user={users.get(id) ?? id} members={members} /> <span className="truncate">{nameOf(id)}</span>
        </>
      ),
      label: nameOf(id),
      count: byAssignee.get(id)!.length,
      tasks: byAssignee.get(id)!,
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
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-tg-text">
            <input
              type="checkbox"
              checked={showEveryone}
              onChange={(e) => onSearchChange({ everyone: e.target.checked || undefined }, { replace: true })}
              className="h-5 w-5 accent-[var(--tg-theme-button-color)]"
            />
            Show everyone ({idle.length} with no tasks)
          </label>
        </div>
      )}
      <KanbanBoard
        columns={columns}
        renderCard={(task, { isOverlay }) => renderCard(task, isOverlay)}
        onMove={(task, _from, to) => onAssigneeChange(task, to === UNASSIGNED ? null : to)}
      />
    </>
  );
}

function BoardSkeleton({ view }: { view: BoardView }) {
  if (view === 'list') {
    return (
      <div className="flex flex-col gap-2 px-4 pt-3">
        {[0, 1, 2, 3].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }
  return (
    <div className="no-scrollbar flex gap-3 overflow-hidden px-4 pt-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex w-[80vw] max-w-[320px] shrink-0 flex-col gap-1.5 rounded-lg bg-tg-secondary p-1.5 md:w-auto md:max-w-none md:flex-1">
          <Skeleton className="m-1 h-5 w-24" />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}
