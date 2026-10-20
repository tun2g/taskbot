import type { EpicWithProgress } from '@tbot/shared';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { formatEpicProgress } from '@/lib/epics';

interface MarkDoneDialogProps {
  epic: EpicWithProgress;
  onConfirm: () => void;
  onCancel: () => void;
  onShowOpen: () => void;
}

/** "3 tasks are still open. Mark done anyway?" — marking an epic done doesn't touch its tasks. */
export function MarkDoneDialog({ epic, onConfirm, onCancel, onShowOpen }: MarkDoneDialogProps) {
  const { open } = formatEpicProgress(epic);
  return (
    <Dialog
      role="alertdialog"
      size="sm"
      hideClose
      title={`${open} task${open === 1 ? ' is' : 's are'} still open. Mark done anyway?`}
      description={`“${epic.title}” moves to Done epics; its open tasks stay as they are.`}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            Mark done
          </Button>
        </>
      }
    >
      <Button variant="link" size="sm" onClick={onShowOpen} className="self-start">
        See the open task{open === 1 ? '' : 's'} ›
      </Button>
    </Dialog>
  );
}
