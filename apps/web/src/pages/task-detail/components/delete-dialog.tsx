import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorBox } from '@/components/ui/input';

interface DeleteDialogProps {
  taskNumber: number;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteDialog({ taskNumber, isDeleting, error, onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <Dialog
      role="alertdialog"
      size="sm"
      hideClose
      title={`Delete #${taskNumber} for everyone?`}
      description="It disappears from the board and its card is removed from the group chat. This can't be undone."
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={isDeleting} loadingText="Deleting…">
            Delete #{taskNumber}
          </Button>
        </>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
    </Dialog>
  );
}
