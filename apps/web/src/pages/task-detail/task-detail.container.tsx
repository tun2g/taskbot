import type { IEpic, ITask, UpdateTaskInput } from '@tbot/shared';
import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { useState } from 'react';

import { useCreateEpic, useEpics } from '@/api/epics';
import { useGroup, useGroupMembers } from '@/api/groups';
import type { EpicFormValues } from '@/components/epics/epic-form-dialog';
import { useDeleteTask, useTask, useTaskActivity, useUpdateTask } from '@/api/tasks';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage, getErrorStatus, isGroupUnavailableError } from '@/lib/api-client';
import { getEpicId, resolveEpic } from '@/lib/epics';
import { haptic, isLandedTask } from '@/lib/telegram';

import { recallBoardSearch } from '../tasks/board-search';
import { useUndoableTaskChange } from '../tasks/use-undoable-change';
import { useParentChange } from './components/subtasks/use-parent-change';
import { TaskDetailContent } from './task-detail.content';

export type SaveResult = { ok: true } | { ok: false; message: string };

/** Keep the board's view / grouping, drop the other filters. */
function pickView(groupId: string) {
  const { view, groupBy } = recallBoardSearch(groupId);
  return { view, groupBy };
}

export function TaskDetailContainer() {
  const { groupId, taskId } = useParams({ from: '/$groupId/tasks/$taskId' });
  const { from } = useSearch({ from: '/$groupId/tasks/$taskId' });
  const navigate = useNavigate();
  const router = useRouter();
  const toast = useToast();

  const task = useTask(taskId);
  const group = useGroup(groupId);
  const activity = useTaskActivity(taskId);
  const { data: members = [] } = useGroupMembers(groupId);
  const updateTask = useUpdateTask(groupId);
  const quick = useUndoableTaskChange(groupId, members);
  const deleteTask = useDeleteTask(groupId);
  const { data: epics = [] } = useEpics(groupId);
  const createEpic = useCreateEpic(groupId);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const changeParent = useParentChange(groupId);

  const goToBoard = () => {
    navigate({ to: '/$groupId/tasks', params: { groupId }, search: recallBoardSearch(groupId) });
  };

  /** Opened from another task (a parent's subtask list): back returns to that task, not all the way to the board. */
  const handleBack = () => {
    if (!from) return goToBoard();
    if (router.history.canGoBack()) return router.history.back();
    navigate({ to: '/$groupId/tasks/$taskId', params: { groupId, taskId: from }, replace: true });
  };

  /** Epic changes get the same "· Undo" toast as status / assignee (the shared hook covers only those two). */
  const changeEpic = async (current: ITask, epicId: string | null, optimisticRef?: ITask['epicId']): Promise<SaveResult> => {
    const previousId = getEpicId(current.epicId);
    if (previousId === epicId) return { ok: true };
    const previous = resolveEpic(current.epicId, epics);
    // A just-created epic may not be in the list yet — the picker passes it as the optimistic value.
    const next = epicId ? (resolveEpic(optimisticRef ?? epicId, epics) ?? resolveEpic(epicId, epics)) : null;
    const n = current.taskNumber;
    const message = !epicId
      ? `Removed #${n} from “${previous?.title ?? 'its epic'}”`
      : previousId
        ? `Moved #${n} to “${next?.title ?? 'another epic'}”`
        : `Added #${n} to “${next?.title ?? 'an epic'}”`;
    const key = `task-change:${current._id}`;
    const { mutateAsync } = quick.updateTask;
    try {
      await mutateAsync({ taskId: current._id, input: { epicId }, optimistic: { epicId: next ?? epicId } });
    } catch (err) {
      const msg = getErrorMessage(err, "Couldn't save.");
      toast.error(`Couldn't update #${n}: ${msg}`, { key });
      return { ok: false, message: msg };
    }
    haptic('success');
    toast.success(message, {
      key,
      action: {
        label: 'Undo',
        onClick: () => {
          mutateAsync({
            taskId: current._id,
            input: { epicId: previousId },
            optimistic: { epicId: current.epicId ?? null },
          }).then(
            () => toast.info(`Undid the change to #${n}`, { key }),
            (err) => toast.error(`Couldn't undo the change to #${n}: ${getErrorMessage(err)}`, { key }),
          );
        },
      },
    });
    return { ok: true };
  };

  const handleUpdate = async (input: UpdateTaskInput, optimistic?: Partial<ITask>): Promise<SaveResult> => {
    // Status and assignee changes get an "Undo" toast, like on the board.
    const keys = Object.keys(input);
    if (task.data && keys.length === 1 && input.status !== undefined) {
      return quick.changeStatus(task.data, input.status);
    }
    if (task.data && keys.length === 1 && input.assigneeId !== undefined) {
      return quick.changeAssignee(task.data, input.assigneeId);
    }
    if (task.data && keys.length === 1 && input.epicId !== undefined) {
      return changeEpic(task.data, input.epicId, optimistic?.epicId);
    }
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
      notFound={
        task.isError && (status === 404 || status === 403)
          ? { status, message: getErrorMessage(task.error), groupUnavailable: isGroupUnavailableError(task.error) }
          : null
      }
      onBackToGroups={() => navigate({ to: '/' })}
      loadError={task.isError && status !== 404 && status !== 403 ? getErrorMessage(task.error) : null}
      onRetry={() => task.refetch()}
      timeZone={group.data?.timezone}
      groupName={group.data?.groupName}
      members={members}
      epics={epics}
      onCreateEpic={handleCreateEpic}
      isCreatingEpic={createEpic.isPending}
      onOpenEpicBoard={(epicId) =>
        navigate({ to: '/$groupId/tasks', params: { groupId }, search: { ...pickView(groupId), epic: epicId } })
      }
      activity={activity.data ?? []}
      activityLoading={activity.isLoading}
      activityError={activity.isError ? getErrorMessage(activity.error) : null}
      onRetryActivity={() => activity.refetch()}
      onBack={handleBack}
      onOpenTask={(id) =>
        navigate({ to: '/$groupId/tasks/$taskId', params: { groupId, taskId: id }, search: { from: taskId } })
      }
      onBackToBoard={goToBoard}
      onChangeParent={(parent) => task.data && void changeParent(task.data, parent)}
      quickLook={isLandedTask(groupId, taskId)}
      onUpdate={handleUpdate}
      isUpdating={updateTask.isPending || quick.updateTask.isPending}
      onDelete={handleDelete}
      isDeleting={deleteTask.isPending}
      deleteError={deleteError}
      onClearDeleteError={() => setDeleteError(null)}
    />
  );
}
