import type { ITask, UpdateTaskInput } from '@tbot/shared';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';

import { useGroup, useGroupMembers } from '@/api/groups';
import { useDeleteTask, useTask, useTaskActivity, useUpdateTask } from '@/api/tasks';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';
import { haptic } from '@/lib/telegram';

import { recallBoardSearch } from '../tasks/board-search';
import { TaskDetailContent } from './task-detail.content';

export type SaveResult = { ok: true } | { ok: false; message: string };

export function TaskDetailContainer() {
  const { groupId, taskId } = useParams({ from: '/$groupId/tasks/$taskId' });
  const navigate = useNavigate();
  const toast = useToast();

  const task = useTask(taskId);
  const group = useGroup(groupId);
  const activity = useTaskActivity(taskId);
  const { data: members = [] } = useGroupMembers(groupId);
  const updateTask = useUpdateTask(groupId);
  const deleteTask = useDeleteTask(groupId);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleBack = () => {
    navigate({ to: '/$groupId/tasks', params: { groupId }, search: recallBoardSearch(groupId) });
  };

  const handleUpdate = async (input: UpdateTaskInput, optimistic?: Partial<ITask>): Promise<SaveResult> => {
    try {
      await updateTask.mutateAsync({ taskId, input, optimistic });
      haptic('success');
      return { ok: true };
    } catch (err) {
      const message = getErrorMessage(err, "Couldn't save.");
      toast.error(message);
      return { ok: false, message };
    }
  };

  const handleDelete = async () => {
    setDeleteError(null);
    try {
      await deleteTask.mutateAsync(taskId);
      toast.success(`Deleted #${task.data?.taskNumber ?? ''}`.trim());
      handleBack();
    } catch (err) {
      haptic('error');
      setDeleteError(getErrorMessage(err, "Couldn't delete the task."));
    }
  };

  const status = getErrorStatus(task.error);

  return (
    <TaskDetailContent
      groupId={groupId}
      task={task.data ?? null}
      isLoading={task.isLoading}
      notFound={task.isError && (status === 404 || status === 403) ? { status, message: getErrorMessage(task.error) } : null}
      loadError={task.isError && status !== 404 && status !== 403 ? getErrorMessage(task.error) : null}
      onRetry={() => task.refetch()}
      timeZone={group.data?.timezone}
      groupName={group.data?.groupName}
      members={members}
      activity={activity.data ?? []}
      activityLoading={activity.isLoading}
      activityError={activity.isError ? getErrorMessage(activity.error) : null}
      onRetryActivity={() => activity.refetch()}
      onBack={handleBack}
      onUpdate={handleUpdate}
      isUpdating={updateTask.isPending}
      onDelete={handleDelete}
      isDeleting={deleteTask.isPending}
      deleteError={deleteError}
      onClearDeleteError={() => setDeleteError(null)}
    />
  );
}
