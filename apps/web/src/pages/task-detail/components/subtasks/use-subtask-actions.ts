import type { ITask, IUser } from '@tbot/shared';
import { isClosedStatus, TaskStatus } from '@tbot/shared';
import { useCallback } from 'react';

import { useCreateTask, useUpdateTask } from '@/api/tasks';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage } from '@/lib/api-client';
import { haptic } from '@/lib/telegram';

import { useUndoableTaskChange } from '../../../tasks/use-undoable-change';
import { useParentChange } from './use-parent-change';

/**
 * Everything the Subtasks section does: add a subtask under `parent`, change a subtask's status or parent (each
 * with the usual "· Undo" toast), and close every open subtask at once.
 */
export function useSubtaskActions(groupId: string, parent: ITask, members: IUser[]) {
  const createTask = useCreateTask(groupId);
  const updateTask = useUpdateTask(groupId);
  const { changeStatus } = useUndoableTaskChange(groupId, members);
  const changeParent = useParentChange(groupId);
  const toast = useToast();
  const { mutateAsync: create } = createTask;
  const { mutateAsync: update } = updateTask;

  const addSubtask = useCallback(
    async ({ title, assigneeId }: { title: string; assigneeId: string | null }): Promise<string | null> => {
      try {
        const task = await create({
          title,
          parentTaskId: parent._id,
          ...(assigneeId ? { assigneeId } : {}),
        });
        haptic('success');
        toast.success(`Added #${task.taskNumber} to #${parent.taskNumber}`, { key: `subtask-add:${parent._id}` });
        return null;
      } catch (err) {
        haptic('error');
        return getErrorMessage(err, "Couldn't add the subtask.");
      }
    },
    [create, parent._id, parent.taskNumber, toast],
  );

  /** Marks every open subtask done (the parent is already closed and they were left behind). */
  const closeOpen = useCallback(
    async (subtasks: ITask[]) => {
      const open = subtasks.filter((t) => !isClosedStatus(t.status));
      const results = await Promise.allSettled(
        open.map((t) =>
          update({ taskId: t._id, input: { status: TaskStatus.DONE }, optimistic: { status: TaskStatus.DONE } }),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) {
        haptic('error');
        toast.error(`Couldn't close ${failed} of ${open.length} subtasks. Try again.`);
      } else {
        haptic('success');
        toast.success(`Marked ${open.length} subtask${open.length === 1 ? '' : 's'} done`);
      }
    },
    [update, toast],
  );

  return {
    addSubtask,
    changeStatus,
    changeParent,
    closeOpen,
    isClosing: updateTask.isPending,
  };
}
