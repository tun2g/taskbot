import type { ITask, TaskParentRef } from '@tbot/shared';
import { useCallback } from 'react';

import { useUpdateTask } from '@/api/tasks';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage } from '@/lib/api-client';
import { getEpicId, resolveEpic } from '@/lib/epics';
import { getParent, getParentId } from '@/lib/subtasks';
import { haptic } from '@/lib/telegram';

const parentRef = (t: ITask): TaskParentRef => ({
  _id: t._id,
  taskNumber: t.taskNumber,
  title: t.title,
  status: t.status,
});

/**
 * The toast, saying what happens to the epic too — joining a parent moves the task into the parent's epic, and
 * leaving one keeps whatever epic it has.
 */
function parentChangeMessage(task: ITask, next: ITask | null, previousNumber: number | null): string {
  const n = task.taskNumber;
  const epic = resolveEpic(task.epicId);
  if (!next) {
    const was = previousNumber ? ` (was under #${previousNumber})` : '';
    return `#${n} is a regular task again${was}${epic ? ` — still in epic “${epic.title}”` : ''}`;
  }
  const base = `#${n} is now a subtask of #${next.taskNumber}`;
  if (getEpicId(next.epicId) === getEpicId(task.epicId)) return base;
  const target = resolveEpic(next.epicId);
  return target
    ? `${base} — moved to epic “${target.title}”`
    : `${base} — taken out of epic “${epic?.title ?? 'its epic'}”`;
}

/**
 * Make a task a subtask of `next` (or a regular task with null), with a "· Undo" toast like status /
 * epic changes. Joining a parent also moves the task into the parent's epic (done by the API).
 */
export function useParentChange(groupId: string) {
  const { mutateAsync } = useUpdateTask(groupId);
  const toast = useToast();

  return useCallback(
    async (task: ITask, next: ITask | null): Promise<void> => {
      const previousId = getParentId(task);
      if ((next?._id ?? null) === previousId) return;
      const previous = getParent(task);
      const n = task.taskNumber;
      const key = `task-change:${task._id}`;
      const message = parentChangeMessage(task, next, previous?.taskNumber ?? null);
      try {
        await mutateAsync({
          taskId: task._id,
          input: { parentTaskId: next?._id ?? null },
          // Joining a parent moves it into the parent's epic (the API does the same).
          optimistic: next ? { parentTaskId: parentRef(next), epicId: next.epicId ?? null } : { parentTaskId: null },
        });
      } catch (err) {
        haptic('error');
        toast.error(`Couldn't update #${n}: ${getErrorMessage(err, "Couldn't save.")}`, { key });
        return;
      }
      haptic('success');
      toast.success(message, {
        key,
        action: {
          label: 'Undo',
          onClick: () => {
            mutateAsync({
              taskId: task._id,
              // Undo also restores the epic it had before joining the parent.
              input: { parentTaskId: previousId, ...(next && !previousId ? { epicId: getEpicId(task.epicId) } : {}) },
              optimistic: { parentTaskId: task.parentTaskId ?? null, epicId: task.epicId ?? null },
            }).then(
              () => toast.info(`Undid the change to #${n}`, { key }),
              (err) => toast.error(`Couldn't undo the change to #${n}: ${getErrorMessage(err)}`, { key }),
            );
          },
        },
      });
    },
    [mutateAsync, toast],
  );
}
