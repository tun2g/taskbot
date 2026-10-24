import { Button } from '@/components/ui/button';

/** Sticky footer: review & save, discard, and what's going on. */
export function SaveBar({
  dirty,
  invalid,
  saving,
  onDiscard,
}: {
  dirty: boolean;
  invalid: boolean;
  saving: boolean;
  onDiscard: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      <Button type="submit" variant="primary" disabled={!dirty} loading={saving}>
        Review and save
      </Button>
      <Button variant="secondary" disabled={!dirty || saving} onClick={onDiscard}>
        Discard changes
      </Button>
      <span className="text-[13px] text-text-3">
        {invalid && dirty
          ? 'Fix the highlighted fields to save.'
          : dirty
            ? 'Unsaved changes. You’ll see a summary before anything is saved.'
            : 'Changes apply within 30 seconds of saving.'}
      </span>
    </div>
  );
}
