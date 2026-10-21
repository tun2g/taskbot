import type { ITask } from '@tbot/shared';

import { useSubtasks } from '@/api/subtasks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorBox } from '@/components/ui/input';
import { isSubtask } from '@/lib/subtasks';

interface DeleteDialogProps {
  task: Pick<ITask, '_id' | 'taskNumber' | 'title' | 'parentTaskId'>;
  /** Subtasks per the task's own counts — replaced by the loaded list when there is one (fresher). */
  subtaskCount?: number;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteDialog({ task, subtaskCount = 0, isDeleting, error, onConfirm, onCancel }: DeleteDialogProps) {
  // A teammate may have added one since the page loaded; the subtask list is refetched on focus.
  const subtasks = useSubtasks(task._id, { enabled: !isSubtask(task) && subtaskCount > 0 });
  const count = subtasks.data?.length ?? subtaskCount;
  const kept =
    count === 1
      ? ' Its subtask stays on the board as a regular task.'
      : count > 1
        ? ` Its ${count} subtasks stay on the board as regular tasks.`
        : '';
  return (
    <Dialog
      role="alertdialog"
      size="sm"
      hideClose
      dismissible={!isDeleting}
      title={`Delete #${task.taskNumber} for everyone?`}
      description={
        <>
          <span className="mb-1.5 block font-medium text-tg-text [overflow-wrap:anywhere]">“{task.title}”</span>
          It disappears from the board and its card is removed from the group chat.{kept} This can't be undone.
        </>
      }
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} autoFocus disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={isDeleting} loadingText="Deleting…">
            Delete #{task.taskNumber}
          </Button>
        </>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
    </Dialog>
  );
}
