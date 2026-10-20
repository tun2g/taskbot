import type { CreateTaskInput, EpicWithProgress, IEpic, ITask, IUser, TaskCounts, TaskStatus } from '@tbot/shared';
import type { ReactNode } from 'react';

import type { ApiTaskFilters } from '@/api/tasks';
import { AiChatPanel } from '@/components/ai-chat/ai-chat-panel';
import { AskAiButton, useAskAi } from '@/components/ai-chat/ask-ai';
import { EpicDot } from '@/components/epics/epic-chip';
import type { EpicFormValues } from '@/components/epics/epic-form-dialog';
import { Layout } from '@/components/layout/layout';
import { Avatar } from '@/components/ui/badges';
import { LoadMore } from '@/components/ui/load-more';
import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { StateMessage } from '@/components/ui/state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { displayName, getUserId, resolveUser } from '@/lib/user';

import type { BoardGroupBy, BoardSearch, BoardView } from './board-search';
import { CreateTaskModal } from './components/create-task-modal';
import { type KanbanColumn, KanbanBoard } from './components/kanban-board';
import { StatusBoard } from './components/status-board';
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
  epics: EpicWithProgress[];
  /** The epic list is still loading — a filtered epic's name isn't known yet. */
  epicsLoading?: boolean;
  /** Loaded tasks of the list view / assignee board (the status board pages per column). */
  tasks: ITask[];
  /** Server total for the current filters. */
  total: number;
  isLoading: boolean;
  isRefetching: boolean;
  error: string | null;
  onRetry: () => void;
  /** Paging of `tasks` (list view / assignee board). */
  hasMore: boolean;
  isFetchingMore: boolean;
  /** Last "load more" failed → stop auto-loading; the button stays. */
  loadMoreFailed: boolean;
  onLoadMore: () => void;
  /** Status board: filters every column applies (each adds its status) + per-status totals. */
  boardFilters: ApiTaskFilters;
  statusCounts: TaskCounts | null;
  hasActiveFilters: boolean;
  overdueCount?: number;
  onSearchChange: (patch: Partial<BoardSearch>, options?: { replace?: boolean }) => void;
  onClearFilters: () => void;
  onBack: () => void;
  onOpenEpics: () => void;
  onTaskClick: (task: ITask) => void;
  onStatusChange: (task: ITask, status: TaskStatus) => void;
  onAssigneeChange: (task: ITask, assigneeId: string | null) => void;
  showCreateModal: boolean;
  onShowCreateModal: (show: boolean) => void;
  onCreateTask: (input: CreateTaskInput) => Promise<string | null>;
  isCreating?: boolean;
  onCreateEpic: (values: EpicFormValues) => Promise<IEpic | string>;
  isCreatingEpic?: boolean;
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
    epics,
    tasks,
    total,
    isLoading,
    error,
    onRetry,
    isRefetching,
    hasMore,
    isFetchingMore,
    loadMoreFailed,
    onLoadMore,
    hasActiveFilters,
    overdueCount,
    onSearchChange,
    onClearFilters,
    onBack,
    onOpenEpics,
    onTaskClick,
    onStatusChange,
    showCreateModal,
    onShowCreateModal,
    onCreateTask,
    isCreating,
    onCreateEpic,
    isCreatingEpic,
  } = props;
  // Filtered to one epic → every card is in it, so the chip would be noise.
  const filteredEpic = search.epic && search.epic !== 'none' ? epics.find((e) => e._id === search.epic) : undefined;
  const hideEpic = !!search.epic && search.epic !== 'none';
  // Filtered to an epic whose name isn't loaded yet → placeholders, never "Deleted epic".
  const epicPending = hideEpic && !filteredEpic && !!props.epicsLoading;
  const ai = useAskAi();

  if (accessError) {
    return (
      <Layout title="Task board" onBack={onBack}>
        <StateMessage
          icon="🔒"
          title="Can't open this board"
          body={accessError}
          action={
            <Button variant="primary" onClick={onBack}>
              Back to your groups
            </Button>
          }
        />
      </Layout>
    );
  }

  const renderCard = (task: ITask, isOverlay = false) => (
    <TaskCard
      task={task}
      members={members}
      epics={epics}
      hideEpic={hideEpic}
      timeZone={timeZone}
      showStatus={groupBy === 'assignee'}
      onClick={isOverlay ? undefined : onTaskClick}
      onStatusChange={isOverlay ? undefined : onStatusChange}
      isOverlay={isOverlay}
    />
  );

  const isStatusBoard = view === 'board' && groupBy === 'status';
  // Status board columns load (with their own skeletons) alongside the counts call.
  const isEmpty = !isLoading && total === 0;
  const loadMore = hasMore ? (
    <LoadMore
      onLoadMore={onLoadMore}
      isLoading={isFetchingMore}
      remaining={total - tasks.length}
      auto={!loadMoreFailed}
      paused={isRefetching}
    />
  ) : null;

  let body: ReactNode;
  if (isLoading && !isStatusBoard) {
    body = <BoardSkeleton view={view} />;
  } else if (error) {
    body = (
      <StateMessage
        icon="⚠️"
        title="Couldn't load tasks"
        body={error}
        action={
          <>
            {hasActiveFilters && (
              <Button variant="secondary" onClick={onClearFilters}>
                Clear filters
              </Button>
            )}
            <Button variant="primary" onClick={onRetry} disabled={isRefetching}>
              {isRefetching ? 'Retrying…' : 'Retry'}
            </Button>
          </>
        }
      />
    );
  } else if (isEmpty && filteredEpic) {
    body = (
      <StateMessage
        icon="⚡"
        title={`No tasks in “${filteredEpic.title}”${hasOtherFilters(search) ? ' match these filters' : ' yet'}`}
        body="Create one here, or open any task and set its Epic field."
        action={
          <>
            <Button variant="secondary" onClick={onClearFilters}>
              Show all tasks
            </Button>
            <Button variant="primary" onClick={() => onShowCreateModal(true)} icon="+">
              Create task
            </Button>
          </>
        }
      />
    );
  } else if (isEmpty && epicPending) {
    body = <BoardSkeleton view={view} />;
  } else if (isEmpty && hasActiveFilters) {
    body = (
      <StateMessage
        icon="🔍"
        title="No tasks match these filters"
        body="Try another search, or clear the filters to see every task."
        action={
          <Button variant="secondary" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    );
  } else if (isEmpty) {
    body = (
      <StateMessage
        icon="📝"
        title="No tasks yet"
        body={
          <>
            Create one here, or send <code>/new …</code> in the group chat.
          </>
        }
        action={
          <Button variant="primary" onClick={() => onShowCreateModal(true)} icon="+">
            Create task
          </Button>
        }
      />
    );
  } else if (view === 'list') {
    body = (
      <TaskList
        tasks={tasks}
        members={members}
        epics={epics}
        hideEpic={hideEpic}
        timeZone={timeZone}
        sort={search.sort}
        dir={search.dir}
        onSortChange={(sort, dir) => onSearchChange({ sort, dir }, { replace: true })}
        onTaskClick={onTaskClick}
        onStatusChange={onStatusChange}
        footer={loadMore}
      />
    );
  } else if (isStatusBoard) {
    body = (
      <StatusBoard
        groupId={groupId}
        filters={props.boardFilters}
        counts={props.statusCounts}
        showAll={!!search.allStatuses}
        onShowAllChange={(v) => onSearchChange({ allStatuses: v || undefined }, { replace: true })}
        onStatusChange={onStatusChange}
        renderCard={renderCard}
      />
    );
  } else {
    body = (
      <AssigneeBoard
        {...props}
        renderCard={renderCard}
        footer={
          hasMore ? (
            <div className="mx-4 mb-4 rounded-lg bg-tg-secondary px-1.5">
              <p className="px-2 pt-2 text-center text-xs text-tg-hint">
                Showing {tasks.length} of {total} tasks
              </p>
              {loadMore}
            </div>
          ) : null
        }
      />
    );
  }

  return (
    <Layout
      width="wide"
      title={groupName ?? <Skeleton className="h-5 w-40" />}
      subtitle={
        filteredEpic ? (
          <span className="inline-flex max-w-full items-center gap-1.5">
            <EpicDot color={filteredEpic.color} />
            <span className="truncate">Epic · {filteredEpic.title}</span>
          </span>
        ) : epicPending ? (
          <span className="inline-flex items-center gap-1.5">
            Epic · <Skeleton className="h-3 w-20" />
          </span>
        ) : search.epic === 'none' ? (
          'Tasks without an epic'
        ) : (
          'Task board'
        )
      }
      onBack={ai.backHandler(onBack)}
      actions={
        <>
          <button
            type="button"
            onClick={onOpenEpics}
            title="Epics — groups of related tasks"
            className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-tg-separator px-2.5 text-sm font-medium text-tg-link transition-colors hover:bg-tg-secondary active:bg-tg-secondary min-[420px]:px-3"
          >
            <span aria-hidden className="hidden min-[420px]:inline">
              ⚡
            </span>
            <span>Epics</span>
          </button>
          <AskAiButton onClick={ai.open ? ai.close : ai.openChat} active={ai.open} />
        </>
      }
      fab={
        <Button
          variant="primary"
          size="fab"
          onClick={() => onShowCreateModal(true)}
          aria-label="New task"
          title="New task"
        >
          +
        </Button>
      }
    >
      <TaskFiltersBar
        search={search}
        view={view}
        groupBy={groupBy}
        members={members}
        epics={epics}
        epicsLoading={props.epicsLoading}
        onChange={onSearchChange}
        onClear={onClearFilters}
        hasActiveFilters={hasActiveFilters}
        overdueCount={overdueCount}
      />

      <div className={isRefetching ? 'opacity-90 transition-opacity' : ''}>{body}</div>

      <CreateTaskModal
        isOpen={showCreateModal}
        members={members}
        epics={epics}
        defaultEpicId={filteredEpic?._id}
        onCreateEpic={onCreateEpic}
        isCreatingEpic={isCreatingEpic}
        onClose={() => onShowCreateModal(false)}
        onSubmit={onCreateTask}
        isLoading={isCreating}
      />

      <AiChatPanel groupId={groupId} open={ai.open} isDesktop={ai.isDesktop} onClose={ai.close} />
    </Layout>
  );
}

function hasOtherFilters(search: BoardSearch): boolean {
  return !!(
    search.type ||
    search.assignee ||
    search.priority ||
    search.due ||
    search.status ||
    search.category ||
    search.q
  );
}

type BoardProps = TasksContentProps & {
  renderCard: (task: ITask, isOverlay?: boolean) => ReactNode;
  footer?: ReactNode;
};

/** Assignee board: one paged list (all statuses) grouped client-side; "Load more" sits under the board. */
function AssigneeBoard({ tasks, members, search, onSearchChange, onAssigneeChange, renderCard, footer }: BoardProps) {
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
        <div
          key={i}
          className="flex w-[80vw] max-w-[320px] shrink-0 flex-col gap-1.5 rounded-lg bg-tg-secondary p-1.5 md:w-auto md:max-w-none md:flex-1"
        >
          <Skeleton className="m-1 h-5 w-24" />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}
