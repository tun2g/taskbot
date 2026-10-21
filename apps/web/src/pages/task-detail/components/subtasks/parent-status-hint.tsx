import type { ITask, SubtaskProgress } from '@tbot/shared';
import { isClosedStatus, TaskStatus } from '@tbot/shared';

import { Button } from '@/components/ui/button';
import { isProgressComplete } from '@/lib/subtasks';

interface ParentStatusHintProps {
  task: ITask;
  progress: SubtaskProgress;
  onParentStatus: (status: TaskStatus) => void;
  onCloseOpen: () => void;
  isClosing?: boolean;
}

/**
 * The parent's status and its subtasks disagree — say so and offer the fix in one tap:
 * every subtask done but the parent open → "Mark #42 done"; parent closed with open subtasks → close them or reopen.
 */
export function ParentStatusHint({ task, progress, onParentStatus, onCloseOpen, isClosing }: ParentStatusHintProps) {
  const closed = isClosedStatus(task.status);
  const open = progress.total - progress.done;

  if (!closed && isProgressComplete(progress)) {
    return (
      <div className="lozenge-done mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1 font-medium">
          {progress.total === 1 ? 'Its subtask is done.' : `All ${progress.total} subtasks are done.`}
        </span>
        <Button variant="link" size="sm" onClick={() => onParentStatus(TaskStatus.DONE)} className="-mr-2">
          Mark #{task.taskNumber} done
        </Button>
      </div>
    );
  }

  if (closed && open > 0) {
    return (
      <div className="tint-link mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1">
          This task is closed, but {open === 1 ? '1 subtask is' : `${open} subtasks are`} still open.
        </span>
        <span className="-mr-2 flex items-center">
          <Button variant="link" size="sm" onClick={onCloseOpen} loading={isClosing} loadingText="Closing…">
            Mark {open === 1 ? 'it' : 'them'} done
          </Button>
          <Button variant="link" size="sm" onClick={() => onParentStatus(TaskStatus.IN_PROGRESS)}>
            Reopen #{task.taskNumber}
          </Button>
        </span>
      </div>
    );
  }

  return null;
}
