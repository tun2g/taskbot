import type { ITask, IUser, TaskStatus } from '@tbot/shared';
import { isClosedStatus, SUBTASKS_MAX } from '@tbot/shared';
import { useEffect, useRef, useState } from 'react';

import { useSubtasks } from '@/api/subtasks';
import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getErrorMessage } from '@/lib/api-client';
import { getProgress, progressOf, subtaskCount } from '@/lib/subtasks';

import { AddSubtaskForm } from './add-subtask-form';
import { ParentStatusHint } from './parent-status-hint';
import { SubtaskProgress } from './subtask-progress';
import { SubtaskRow } from './subtask-row';
import { useSubtaskActions } from './use-subtask-actions';

interface SubtasksSectionProps {
  groupId: string;
  /** The parent (never a subtask itself — the page hides this section for subtasks). */
  task: ITask;
  members: IUser[];
  onOpenTask: (task: ITask) => void;
  /** Changes the parent's own status (the "Mark #42 done" / "Reopen" shortcuts). */
  onParentStatus: (status: TaskStatus) => void;
}

/** Jira-like "Subtasks": progress, one row per subtask, and an inline add form. */
export function SubtasksSection({ groupId, task, members, onOpenTask, onParentStatus }: SubtasksSectionProps) {
  const subtasks = useSubtasks(task._id);
  const actions = useSubtaskActions(groupId, task, members);
  const [adding, setAdding] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);

  // Closing the form hands focus back to "Add subtask" instead of dropping it on <body>.
  useEffect(() => {
    if (wasAdding.current && !adding) addButtonRef.current?.focus({ preventScroll: true });
    wasAdding.current = adding;
  }, [adding]);

  const rows = subtasks.data ?? [];
  // The loaded list is the freshest source; before that, the task's own counts.
  const progress = subtasks.data ? progressOf(rows) : (getProgress(task) ?? { total: 0, done: 0, cancelled: 0 });
  const full = subtaskCount(progress) >= SUBTASKS_MAX;

  return (
    <section aria-labelledby="subtasks-heading">
      <div className="mb-1 flex min-h-6 items-center gap-3">
        <SectionHeading id="subtasks-heading">Subtasks</SectionHeading>
        <div className="-mt-2 ml-auto">
          <SubtaskProgress progress={progress} />
        </div>
      </div>

      {subtasks.data && (
        <ParentStatusHint
          task={task}
          progress={progress}
          onParentStatus={onParentStatus}
          onCloseOpen={() => void actions.closeOpen(rows)}
          isClosing={actions.isClosing}
        />
      )}

      {subtasks.isLoading && subtaskCount(progress) > 0 ? (
        <div className="flex flex-col gap-2 py-1">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-5/6" />
        </div>
      ) : subtasks.isError ? (
        <p className="text-sm text-tg-hint">
          Couldn't load subtasks: {getErrorMessage(subtasks.error)}{' '}
          <Button variant="link" size="sm" onClick={() => void subtasks.refetch()}>
            Retry
          </Button>
        </p>
      ) : rows.length > 0 ? (
        <ul className="divide-y divide-tg-separator rounded-lg border border-tg-separator bg-tg-section">
          {rows.map((sub) => (
            <SubtaskRow
              key={sub._id}
              groupId={groupId}
              task={sub}
              parentNumber={task.taskNumber}
              members={members}
              onOpen={onOpenTask}
              onStatusChange={(t, status) => void actions.changeStatus(t, status)}
              onParentChange={(t, parent) => void actions.changeParent(t, parent)}
            />
          ))}
        </ul>
      ) : (
        !adding && (
          <p className="text-sm text-tg-hint">
            Split this into smaller steps. Each subtask gets its own number, assignee and status.
          </p>
        )
      )}

      {adding ? (
        <AddSubtaskForm
          parentNumber={task.taskNumber}
          members={members}
          onAdd={actions.addSubtask}
          onClose={() => setAdding(false)}
        />
      ) : isClosedStatus(task.status) ? (
        <p className="pt-2 text-xs text-tg-hint">#{task.taskNumber} is closed — reopen it to add subtasks.</p>
      ) : full ? (
        <p className="pt-2 text-xs text-tg-hint">
          #{task.taskNumber} has {SUBTASKS_MAX} subtasks, the most a task can have. Use an epic for bigger work.
        </p>
      ) : (
        <Button
          ref={addButtonRef}
          variant="ghost"
          size="sm"
          icon="＋"
          onClick={() => setAdding(true)}
          className="mt-1 -ml-2 text-tg-link"
        >
          Add subtask
        </Button>
      )}
    </section>
  );
}
