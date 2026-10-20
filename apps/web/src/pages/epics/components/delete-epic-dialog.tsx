import type { EpicWithProgress } from '@tbot/shared';
import { EpicStatus } from '@tbot/shared';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorBox } from '@/components/ui/input';
import { epicTaskCount } from '@/lib/epics';

interface DeleteEpicDialogProps {
  epic: EpicWithProgress;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Counts every task in the epic (cancelled included) — the same number the "Deleted … · N tasks kept" toast shows. */
export function DeleteEpicDialog({ epic, isDeleting, error, onConfirm, onCancel }: DeleteEpicDialogProps) {
  const count = epicTaskCount(epic);
  const cancelled = epic.progress.cancelled ?? 0;
  const tasks = `${count} task${count === 1 ? '' : 's'}`;
  return (
    <Dialog
      role="alertdialog"
      size="sm"
      hideClose
      title={`Delete “${epic.title}”?`}
      description={
        count > 0
          ? `Its ${tasks}${cancelled > 0 ? ` (incl. ${cancelled} cancelled)` : ''} will no longer belong to any epic. The tasks themselves are kept.`
          : 'It has no tasks, so nothing else changes.'
      }
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={isDeleting} loadingText="Deleting…">
            Delete epic
          </Button>
        </>
      }
    >
      {epic.status !== EpicStatus.DONE && count > 0 && (
        <p className="text-sm text-tg-hint">
          Tip: <span className="font-medium text-tg-text">Mark as done</span> instead keeps the history — the tasks stay
          grouped.
        </p>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </Dialog>
  );
}
