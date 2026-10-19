import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

interface EditableTextProps {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
  /** Resolve true when saved; false keeps the editor open with the error shown. */
  onSave: (value: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  displayClassName?: string;
}

/**
 * Click to edit. Saves on blur or Enter (Ctrl/⌘+Enter in multi-line), Esc cancels.
 */
export function EditableText({
  label,
  value,
  placeholder,
  multiline,
  required,
  maxLength,
  onSave,
  displayClassName = '',
}: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      el?.focus();
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const commit = async () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = multiline ? draft.trim() : draft.replace(/\s+/g, ' ').trim();
    if (next === value.trim()) {
      setEditing(false);
      setError(null);
      return;
    }
    if (required && !next) {
      setError(`${label} can't be empty.`);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave(next);
    setSaving(false);
    if (result.ok) setEditing(false);
    else setError(result.message);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelled.current = true;
      setDraft(value);
      setError(null);
      setEditing(false);
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      inputRef.current?.blur();
    }
  };

  const id = `edit-${label.toLowerCase().replace(/\s+/g, '-')}`;

  if (!editing) {
    return (
      <div>
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-tg-hint">{label}</span>
        <button
          type="button"
          onClick={() => {
            cancelled.current = false;
            setEditing(true);
          }}
          className={`-mx-2 block min-h-11 w-[calc(100%+1rem)] rounded-xl px-2 py-1.5 text-left hover:bg-tg-secondary/60 active:bg-tg-secondary ${displayClassName}`}
          aria-label={`Edit ${label.toLowerCase()}`}
        >
          {value ? (
            <span className="whitespace-pre-wrap break-words">{value}</span>
          ) : (
            <span className="text-sm italic text-tg-hint">{placeholder}</span>
          )}
        </button>
      </div>
    );
  }

  const common = {
    id,
    ref: inputRef,
    value: draft,
    maxLength,
    disabled: saving,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown,
    className:
      'w-full rounded-xl border border-tg-link bg-tg-bg px-3 py-2 text-tg-text outline-none disabled:opacity-60 ' +
      displayClassName,
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase tracking-wide text-tg-hint">
        {label}
      </label>
      {multiline ? <textarea {...common} rows={5} /> : <input {...common} type="text" />}
      <p className={`mt-1 text-xs ${error ? 'text-tg-destructive' : 'text-tg-hint'}`} role={error ? 'alert' : undefined}>
        {saving
          ? 'Saving…'
          : error
            ? `${error} Edit and try again, or press Esc to cancel.`
            : multiline
              ? 'Saves when you leave the field (Ctrl/⌘+Enter). Esc cancels.'
              : 'Enter to save · Esc to cancel'}
      </p>
    </div>
  );
}
