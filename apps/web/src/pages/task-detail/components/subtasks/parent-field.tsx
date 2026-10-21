import type { ITask } from '@tbot/shared';

import { Button } from '@/components/ui/button';
import { getParent, getParentId } from '@/lib/subtasks';

import { ParentPicker } from './parent-picker';

interface ParentFieldProps {
  id: string;
  groupId: string;
  task: ITask;
  /** Subtasks (cancelled included) this task has — then it can't become a subtask itself. */
  ownSubtasks: number;
  onOpenParent: (parentId: string) => void;
  /** `null` turns the subtask back into a regular task. */
  onChange: (parent: ITask | null) => void;
}

const changeLinkClass =
  'focus-ring inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-tg-link transition-colors hover:underline sm:min-h-9';

/**
 * "Parent" in the details panel:
 * - a subtask shows its parent (tap to open), "Change" (move under another task) and "Remove";
 * - a regular task picks a parent;
 * - a task that has subtasks can't be nested (one level), and says so instead of hiding the field.
 */
export function ParentField({ id, groupId, task, ownSubtasks, onOpenParent, onChange }: ParentFieldProps) {
  const parentId = getParentId(task);
  const parent = getParent(task);

  if (parentId) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-1">
        <button
          type="button"
          onClick={() => onOpenParent(parentId)}
          title={parent ? `Open #${parent.taskNumber} ${parent.title}` : 'Open the parent task'}
          className="focus-ring -ml-2 flex min-h-11 min-w-0 flex-1 basis-40 items-center gap-1.5 rounded-md px-2 text-left text-sm text-tg-link transition-colors hover:bg-tg-secondary active:bg-tg-secondary"
        >
          <span className="shrink-0 font-mono text-xs">#{parent?.taskNumber ?? '…'}</span>
          <span className="truncate">{parent?.title ?? 'Parent task'}</span>
        </button>
        <span className="flex shrink-0 items-center">
          <ParentPicker
            groupId={groupId}
            task={task}
            title={`Move #${task.taskNumber} under`}
            variant="custom"
            triggerLabel="Move it under another task"
            triggerClassName={changeLinkClass}
            onPick={onChange}
          >
            Change
          </ParentPicker>
          <Button
            variant="link"
            size="sm"
            aria-label="Remove the parent — make this a regular task"
            onClick={() => onChange(null)}
          >
            Remove
          </Button>
        </span>
      </div>
    );
  }

  if (ownSubtasks > 0) {
    return (
      <p id={id} className="flex min-h-11 items-center text-sm text-tg-hint">
        Has {ownSubtasks === 1 ? 'a subtask' : `${ownSubtasks} subtasks`}, so it can't be a subtask itself.
      </p>
    );
  }

  return <ParentPicker id={id} groupId={groupId} task={task} onPick={onChange} />;
}
