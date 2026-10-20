import type { CreateTaskInput, IEpic, ITask, TaskStatus } from '@tbot/shared';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCreateEpic, useEpics } from '@/api/epics';
import { useGroup, useGroupMembers } from '@/api/groups';
import type { EpicFormValues } from '@/components/epics/epic-form-dialog';
import { flattenTaskPages, matchesTaskFilters } from '@/api/task-cache';
import { type ApiTaskFilters, useCreateTask, useTaskCounts, useTaskPages, useTaskStats } from '@/api/tasks';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';
import { haptic } from '@/lib/telegram';

import { type BoardSearch, rememberBoardSearch } from './board-search';
import { TasksContent } from './tasks.content';
import { useUndoableTaskChange } from './use-undoable-change';

export function TasksContainer() {
  const { groupId } = useParams({ from: '/$groupId/tasks/' });
  const search = useSearch({ from: '/$groupId/tasks/' });
  const navigate = useNavigate({ from: '/$groupId/tasks/' });
  const toast = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const view = search.view ?? 'board';
  const groupBy = search.groupBy ?? 'status';

  useEffect(() => rememberBoardSearch(groupId, search), [groupId, search]);

  const isStatusBoard = view === 'board' && groupBy === 'status';

  // Filters every view shares; the status board's columns each add their own `status`.
  const boardFilters = useMemo<ApiTaskFilters>(
    () => ({
      type: search.type,
      assigneeId: search.assignee,
      priority: search.priority,
      epicId: search.epic,
      due: search.due,
      search: search.q,
    }),
    [search.type, search.assignee, search.priority, search.epic, search.due, search.q],
  );

  const filters = useMemo<ApiTaskFilters>(() => {
    // Status / category filters and sorting apply to the list view only; boards show every column.
    if (view !== 'list') return boardFilters;
    const category = search.category;
    return {
      ...boardFilters,
      status: !category ? search.status : undefined,
      category: category && category !== 'open' ? category : undefined,
      open: category === 'open' ? true : undefined,
      sort: search.sort,
      dir: search.sort ? search.dir : undefined,
    };
  }, [boardFilters, view, search.status, search.category, search.sort, search.dir]);
  const hasActiveFilters = !!(
    filters.type ||
    filters.assigneeId ||
    filters.priority ||
    filters.epicId ||
    filters.due ||
    filters.status ||
    filters.category ||
    filters.open ||
    filters.search
  );

  const group = useGroup(groupId);
  const { data: members = [] } = useGroupMembers(groupId);
  // List view / assignee board page through one list; the status board counts here and pages per column.
  const pages = useTaskPages(groupId, filters, { enabled: !isStatusBoard });
  const counts = useTaskCounts(groupId, boardFilters, { enabled: isStatusBoard });
  const loadedTasks = useMemo(() => flattenTaskPages(pages.data), [pages.data]);
  const primary = isStatusBoard ? counts : pages;
  const total = isStatusBoard ? (counts.data?.total ?? 0) : (pages.data?.pages.at(-1)?.meta.total ?? 0);
  const createTask = useCreateTask(groupId);
  const epicsQuery = useEpics(groupId);
  const epics = useMemo(() => epicsQuery.data ?? [], [epicsQuery.data]);
  const createEpic = useCreateEpic(groupId);
  const stats = useTaskStats(groupId);
  const { changeStatus, changeAssignee } = useUndoableTaskChange(groupId, members);

  const setSearch = useCallback(
    (patch: Partial<BoardSearch>, options?: { replace?: boolean }) => {
      navigate({ search: (prev) => ({ ...prev, ...patch }), replace: options?.replace });
    },
    [navigate],
  );

  // Filtered to an epic that no longer exists (deleted here or by someone else): drop the filter once the epic list
  // has loaded fresh, instead of an empty board titled "Deleted epic".
  const staleEpicToasted = useRef<string | null>(null);
  useEffect(() => {
    const epicId = search.epic;
    if (!epicId || epicId === 'none' || !epicsQuery.isSuccess || epicsQuery.isFetching) return;
    if (epics.some((e) => e._id === epicId)) return;
    setSearch({ epic: undefined }, { replace: true });
    if (staleEpicToasted.current !== epicId) {
      staleEpicToasted.current = epicId;
      toast.info('That epic was deleted');
    }
  }, [search.epic, epics, epicsQuery.isSuccess, epicsQuery.isFetching, setSearch, toast]);

  const clearFilters = useCallback(() => {
    setSearch({
      type: undefined,
      assignee: undefined,
      priority: undefined,
      epic: undefined,
      due: undefined,
      status: undefined,
      category: undefined,
      q: undefined,
    });
  }, [setSearch]);

  const handleTaskClick = (task: ITask) => {
    navigate({ to: '/$groupId/tasks/$taskId', params: { groupId, taskId: task._id } });
  };

  // Optimistic, with a "Moved #12 to … · Undo" toast (errors roll back and toast).
  const handleStatusChange = (task: ITask, status: TaskStatus) => void changeStatus(task, status);
  const handleAssigneeChange = (task: ITask, assigneeId: string | null) => void changeAssignee(task, assigneeId);

  const handleCreateTask = async (input: CreateTaskInput): Promise<string | null> => {
    try {
      const task = await createTask.mutateAsync(input);
      setShowCreateModal(false);
      // Say so when the filters hide it — otherwise "Created #12" and nothing appears looks like a failure.
      if (matchesTaskFilters(task, filters) === false) {
        toast.success(`Created #${task.taskNumber} — not in this view`, {
          action: { label: 'Open', onClick: () => handleTaskClick(task) },
        });
      } else {
        toast.success(`Created #${task.taskNumber}`);
      }
      return null;
    } catch (err) {
      haptic('error');
      return getErrorMessage(err, "Couldn't create the task.");
    }
  };

  const handleCreateEpic = async (values: EpicFormValues): Promise<IEpic | string> => {
    try {
      const epic = await createEpic.mutateAsync({
        title: values.title,
        description: values.description || undefined,
        color: values.color,
      });
      toast.success(`Created epic “${epic.title}”`);
      return epic;
    } catch (err) {
      haptic('error');
      return getErrorMessage(err, "Couldn't create the epic.");
    }
  };

  const groupError = group.isError ? group.error : null;
  const groupStatus = getErrorStatus(groupError);

  return (
    <TasksContent
      groupId={groupId}
      groupName={group.data?.groupName}
      timeZone={group.data?.timezone}
      accessError={groupStatus === 403 || groupStatus === 404 ? getErrorMessage(groupError) : null}
      search={search}
      view={view}
      groupBy={groupBy}
      members={members}
      epics={epics}
      epicsLoading={epicsQuery.isLoading}
      tasks={isStatusBoard ? [] : loadedTasks}
      total={total}
      isLoading={primary.isLoading}
      isRefetching={primary.isFetching && !primary.isLoading && !pages.isFetchingNextPage}
      error={primary.isError && !primary.data ? getErrorMessage(primary.error) : null}
      onRetry={() => void primary.refetch()}
      hasMore={!isStatusBoard && pages.hasNextPage}
      isFetchingMore={pages.isFetchingNextPage}
      loadMoreFailed={pages.isFetchNextPageError}
      onLoadMore={() => {
        // Don't cut short a refetch of the loaded pages (after a move / create).
        if (!pages.isFetching) void pages.fetchNextPage();
      }}
      boardFilters={boardFilters}
      statusCounts={counts.data ?? null}
      hasActiveFilters={hasActiveFilters}
      overdueCount={stats.data?.overdue ?? 0}
      onSearchChange={setSearch}
      onClearFilters={clearFilters}
      onBack={() => navigate({ to: '/' })}
      onOpenEpics={() => navigate({ to: '/$groupId/epics', params: { groupId } })}
      onTaskClick={handleTaskClick}
      onStatusChange={handleStatusChange}
      onAssigneeChange={handleAssigneeChange}
      showCreateModal={showCreateModal}
      onShowCreateModal={setShowCreateModal}
      onCreateTask={handleCreateTask}
      isCreating={createTask.isPending}
      onCreateEpic={handleCreateEpic}
      isCreatingEpic={createEpic.isPending}
    />
  );
}
