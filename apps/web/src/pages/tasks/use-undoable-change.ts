import type { ITask, IUser, TaskStatus, UpdateTaskInput } from '@tbot/shared';
import { TASK_STATUS_LABELS } from '@tbot/shared';
import { useCallback } from 'react';

import { useUpdateTask } from '@/api/tasks';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage } from '@/lib/api-client';
import { haptic } from '@/lib/telegram';
import { displayName, getUserId } from '@/lib/user';

export type ChangeResult = { ok: true } | { ok: false; message: string };

/**
 * Quick status / assignee changes (board drag, ⋯ menu, detail pickers) with an optimistic update
 * and a "Moved #12 to 👀 In review · Undo" toast. Undo PATCHes the previous value back.
 */
export function useUndoableTaskChange(groupId: string, members: IUser[]) {
  const updateTask = useUpdateTask(groupId);
  const toast = useToast();
  const { mutateAsync } = updateTask;

  const apply = useCallback(
    async (
      task: ITask,
      change: { input: UpdateTaskInput; optimistic: Partial<ITask>; message: string },
      undo: { input: UpdateTaskInput; optimistic: Partial<ITask> },
    ): Promise<ChangeResult> => {
      const key = `task-change:${task._id}`;
      try {
        await mutateAsync({ taskId: task._id, input: change.input, optimistic: change.optimistic });
      } catch (err) {
        const message = getErrorMessage(err, "Couldn't save.");
        toast.error(`Couldn't update #${task.taskNumber}: ${message}`, { key });
        return { ok: false, message };
      }
      haptic('success');
      toast.success(change.message, {
        key,
        action: {
          label: 'Undo',
          onClick: () => {
            mutateAsync({ taskId: task._id, input: undo.input, optimistic: undo.optimistic }).then(
              () => toast.info(`Undid the change to #${task.taskNumber}`, { key }),
              (err) =>
                toast.error(`Couldn't undo the change to #${task.taskNumber}: ${getErrorMessage(err)}`, { key }),
            );
          },
        },
      });
      return { ok: true };
    },
    [mutateAsync, toast],
  );

  const changeStatus = useCallback(
    (task: ITask, status: TaskStatus): Promise<ChangeResult> => {
      if (task.status === status) return Promise.resolve({ ok: true });
      return apply(
        task,
        {
          input: { status },
          optimistic: { status },
          message: `Moved #${task.taskNumber} to ${TASK_STATUS_LABELS[status]}`,
        },
        { input: { status: task.status }, optimistic: { status: task.status } },
      );
    },
    [apply],
  );

  const changeAssignee = useCallback(
    (task: ITask, assigneeId: string | null): Promise<ChangeResult> => {
      const previousId = getUserId(task.assigneeId);
      if (previousId === assigneeId) return Promise.resolve({ ok: true });
      const member = assigneeId ? members.find((m) => m._id === assigneeId) : null;
      return apply(
        task,
        {
          input: { assigneeId },
          optimistic: { assigneeId: member ?? assigneeId },
          message: assigneeId
            ? `Assigned #${task.taskNumber} to ${displayName(member ?? assigneeId, { members, fallback: 'someone' })}`
            : `Unassigned #${task.taskNumber}`,
        },
        { input: { assigneeId: previousId }, optimistic: { assigneeId: task.assigneeId ?? null } },
      );
    },
    [apply, members],
  );

  return { changeStatus, changeAssignee, updateTask };
}
