import type { IEpic } from '@tbot/shared';
import { EPIC_COLOR_ORDER, EPIC_TITLE_MAX, EpicColor } from '@tbot/shared';
import { type FormEvent, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorBox, FormField, Input, Textarea, fieldLabelClass } from '@/components/ui/input';
import { epicColorClasses, suggestEpicColor } from '@/lib/epics';

export const EPIC_DESCRIPTION_MAX = 1000;

export interface EpicFormValues {
  title: string;
  description: string;
  color: EpicColor;
}

interface EpicFormDialogProps {
  /** Edit this epic; omit to create a new one. */
  epic?: Pick<IEpic, 'title' | 'description' | 'color'>;
  /** The group's epics — a new epic gets the least-used color by default. */
  existing?: Pick<IEpic, 'color'>[];
  onClose: () => void;
  /** Resolves to null on success, or an error message to show (e.g. duplicate name). */
  onSubmit: (values: EpicFormValues) => Promise<string | null>;
  isSaving?: boolean;
}

/** Create / edit sheet: name, description and a color swatch row. */
export function EpicFormDialog({ epic, existing = [], onClose, onSubmit, isSaving }: EpicFormDialogProps) {
  const [title, setTitle] = useState(epic?.title ?? '');
  const [description, setDescription] = useState(epic?.description ?? '');
  const [color, setColor] = useState<EpicColor>(() => epic?.color ?? suggestEpicColor(existing));
  const [error, setError] = useState<string | null>(null);
  const editing = !!epic;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // when opened from inside another form (create task)
    if (!title.trim() || isSaving) return;
    setError(null);
    const message = await onSubmit({ title: title.trim(), description: description.trim(), color });
    if (message) setError(message);
  };

  return (
    <Dialog
      title={editing ? 'Edit epic' : 'New epic'}
      description={editing ? undefined : 'An epic groups related tasks under one bigger goal.'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField
          label="Name"
          htmlFor="epic-title"
          required
          hint={title.length > EPIC_TITLE_MAX - 15 ? `${title.length}/${EPIC_TITLE_MAX}` : undefined}
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full ${epicColorClasses(color).solid}`} />
            <Input
              id="epic-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Website relaunch"
              required
              maxLength={EPIC_TITLE_MAX}
              autoFocus
              autoComplete="off"
            />
          </div>
        </FormField>

        <div>
          <span id="epic-color-label" className={fieldLabelClass}>
            Color
          </span>
          <div role="radiogroup" aria-labelledby="epic-color-label" className="-mx-1.5 flex flex-wrap">
            {EPIC_COLOR_ORDER.map((c) => {
              const selected = c === color;
              const cls = epicColorClasses(c);
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={cls.name}
                  title={cls.name}
                  onClick={() => setColor(c)}
                  className="focus-ring flex h-11 w-11 items-center justify-center rounded-full"
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-transform ${cls.onSolid} ${cls.solid} ${
                      selected ? 'scale-110 ring-2 ring-tg-link ring-offset-2 ring-offset-tg-section' : ''
                    }`}
                  >
                    {selected ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <FormField label="Description" htmlFor="epic-description" hint="Optional — what does “done” mean for this epic?">
          <Textarea
            id="epic-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={EPIC_DESCRIPTION_MAX}
          />
        </FormField>

        {error && <ErrorBox>{error}</ErrorBox>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!title.trim()}
            loading={isSaving}
            loadingText={editing ? 'Saving…' : 'Creating…'}
          >
            {editing ? 'Save' : 'Create epic'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
