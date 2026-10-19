import type { CreateTaskInput, ITask, TaskStatus } from '@tbot/shared';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useGroup, useGroupMembers } from '@/api/groups';
import { type ApiTaskFilters, BOARD_LIMIT, useCreateTask, useTasksList, useTaskStats } from '@/api/tasks';
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

  const filters = useMemo<ApiTaskFilters>(() => {
    // Status / category filters apply to the list view only; the status board shows every column.
    const listOnly = view === 'list';
    const category = listOnly ? search.category : undefined;
    return {
      type: search.type,
      assigneeId: search.assignee,
      priority: search.priority,
      due: search.due,
      status: listOnly && !category ? search.status : undefined,
      category: category && category !== 'open' ? category : undefined,
      open: category === 'open' ? true : undefined,
      search: search.q,
      limit: BOARD_LIMIT,
    };
  }, [search.type, search.assignee, search.priority, search.due, search.status, search.category, search.q, view]);
  const hasActiveFilters = !!(
    filters.type ||
    filters.assigneeId ||
    filters.priority ||
    filters.due ||
    filters.status ||
    filters.category ||
    filters.open ||
    filters.search
  );

  const group = useGroup(groupId);
  const { data: members = [] } = useGroupMembers(groupId);
  const tasks = useTasksList(groupId, filters);
  const createTask = useCreateTask(groupId);
  const stats = useTaskStats(groupId);
  const { changeStatus, changeAssignee } = useUndoableTaskChange(groupId, members);

  const setSearch = useCallback(
    (patch: Partial<BoardSearch>, options?: { replace?: boolean }) => {
      navigate({ search: (prev) => ({ ...prev, ...patch }), replace: options?.replace });
    },
    [navigate],
  );

  const clearFilters = useCallback(() => {
    setSearch({
      type: undefined,
      assignee: undefined,
      priority: undefined,
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
      toast.success(`Created #${task.taskNumber}`);
      return null;
    } catch (err) {
      haptic('error');
      return getErrorMessage(err, "Couldn't create the task.");
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
      tasks={tasks.data?.data ?? []}
      total={tasks.data?.meta.total ?? 0}
      isLoading={tasks.isLoading}
      isRefetching={tasks.isFetching && !tasks.isLoading}
      error={tasks.isError ? getErrorMessage(tasks.error) : null}
      onRetry={() => tasks.refetch()}
      hasActiveFilters={hasActiveFilters}
      overdueCount={stats.data?.overdue ?? 0}
      onSearchChange={setSearch}
      onClearFilters={clearFilters}
      onBack={() => navigate({ to: '/' })}
      onTaskClick={handleTaskClick}
      onStatusChange={handleStatusChange}
      onAssigneeChange={handleAssigneeChange}
      showCreateModal={showCreateModal}
      onShowCreateModal={setShowCreateModal}
      onCreateTask={handleCreateTask}
      isCreating={createTask.isPending}
    />
  );
}
