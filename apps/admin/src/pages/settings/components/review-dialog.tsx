import { ConfirmDialog } from '@/components/ui/dialog';

/** "Save these changes?" with one line per change ("Daily budget: none → $1.50"), before anything is written. */
export function ReviewDialog({
  lines,
  saving,
  onCancel,
  onConfirm,
}: {
  /** null = closed. */
  lines: string[] | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={!!lines}
      pending={saving}
      onCancel={onCancel}
      onConfirm={onConfirm}
      options={{
        title: 'Save these changes?',
        body: (
          <>
            <ul className="list-disc space-y-1 pl-5 text-[15px] text-text">
              {(lines ?? []).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="text-[13px] text-text-3">
              The bot applies them within 30 seconds. They’re recorded in the audit log, where you can restore the
              earlier values.
            </p>
          </>
        ),
        confirmLabel: 'Save changes',
        cancelLabel: 'Keep editing',
      }}
    />
  );
}
