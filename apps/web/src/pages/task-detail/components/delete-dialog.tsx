import { useEffect } from 'react';

import { buttonDanger, buttonSecondary } from '@/components/ui/state';

interface DeleteDialogProps {
  taskNumber: number;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteDialog({ taskNumber, isDeleting, error, onConfirm, onCancel }: DeleteDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="alertdialog" aria-modal aria-labelledby="delete-title" aria-describedby="delete-body">
      <div className="fixed inset-0 bg-black/40" onClick={onCancel} />
      <div className="pb-safe relative w-full max-w-md rounded-t-2xl bg-tg-bg px-5 pt-5 shadow-xl sm:rounded-2xl">
        <h2 id="delete-title" className="text-lg font-semibold text-tg-text">
          Delete #{taskNumber} for everyone?
        </h2>
        <p id="delete-body" className="mt-2 text-sm text-tg-hint">
          It disappears from the board and its card is removed from the group chat. This can't be undone.
        </p>
        {error && (
          <p role="alert" className="mt-3 tint-danger rounded-xl p-3 text-sm">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className={buttonSecondary} autoFocus>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={isDeleting} className={buttonDanger}>
            {isDeleting ? 'Deleting…' : `Delete #${taskNumber}`}
          </button>
        </div>
      </div>
    </div>
  );
}
