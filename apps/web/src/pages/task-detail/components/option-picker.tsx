import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface OptionPickerProps<T extends string> {
  /** Accessible name; the visible label is the Details row label. */
  ariaLabel: string;
  value: T;
  groups: { label?: string; options: PickerOption<T>[] }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** How an option looks (trigger and list), e.g. a status lozenge. */
  renderOption?: (option: PickerOption<T>) => ReactNode;
}

/**
 * Jira-style field dropdown: the trigger shows the current value; the panel lists every
 * option with its hint, grouped. Closes on outside click / Esc.
 */
export function OptionPicker<T extends string>({ ariaLabel, value, groups, onChange, disabled, renderOption }: OptionPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const current = groups.flatMap((g) => g.options).find((o) => o.value === value);
  const render = (o: PickerOption<T>) => (renderOption ? renderOption(o) : <span className="text-sm text-tg-text">{o.label}</span>);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${ariaLabel}: ${current?.label ?? 'not set'}. Change`}
        disabled={disabled}
        className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left hover:bg-tg-secondary disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">{current ? render(current) : <span className="text-sm text-tg-hint">Not set</span>}</span>
        <span aria-hidden className="text-xs text-tg-hint">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={listId}
          role="radiogroup"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 z-40 mt-1 max-h-[60vh] min-w-[240px] overflow-y-auto rounded-lg border border-tg-separator bg-tg-section p-1 shadow-xl"
        >
          {groups.map((group, i) => (
            <div key={group.label ?? i} className={i > 0 ? 'mt-1 border-t border-tg-separator pt-1' : ''}>
              {group.label && (
                <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-tg-hint">{group.label}</p>
              )}
              {group.options.map((o) => {
                const selected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setOpen(false);
                      if (!selected) onChange(o.value);
                    }}
                    className={`flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-tg-secondary ${
                      selected ? 'tint-selected' : ''
                    }`}
                  >
                    <span className="flex w-full items-center gap-2">
                      {render(o)}
                      {selected && (
                        <span className="ml-auto text-sm text-tg-link" aria-hidden>
                          ✓
                        </span>
                      )}
                    </span>
                    {o.hint && <span className="text-xs text-tg-hint">{o.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
