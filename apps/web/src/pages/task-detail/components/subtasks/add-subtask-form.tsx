import type { IUser } from '@tbot/shared';
import { type FormEvent, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorBox, inputClass } from '@/components/ui/input';

import { AssigneePicker } from '../assignee-picker';

const TITLE_MAX = 200;

interface AddSubtaskFormProps {
  parentNumber: number;
  members: IUser[];
  /** Resolves to null when created, or an error message. */
  onAdd: (input: { title: string; assigneeId: string | null }) => Promise<string | null>;
  onClose: () => void;
}

/**
 * Inline "add subtask": Enter adds and keeps the form open for the next one (the assignee is kept too).
 * Escape clears a typed title first, and closes the form on an empty one.
 */
export function AddSubtaskForm({ parentNumber, members, onAdd, onClose }: AddSubtaskFormProps) {
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    const failure = await onAdd({ title: trimmed, assigneeId });
    setSaving(false);
    if (failure) {
      setError(failure);
    } else {
      setTitle('');
    }
    inputRef.current?.focus();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 pt-2">
      <input
        ref={inputRef}
        className={inputClass}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          if (title) {
            setTitle('');
            setError(null);
          } else {
            onClose();
          }
        }}
        maxLength={TITLE_MAX}
        placeholder="What needs to be done?"
        aria-label={`New subtask of #${parentNumber}`}
        aria-invalid={error ? true : undefined}
        enterKeyHint="done"
      />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <AssigneePicker
            id={`new-subtask-assignee-${parentNumber}`}
            members={members}
            assignee={assigneeId}
            onSelect={setAssigneeId}
            appearance="input"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!title.trim()}
          loading={saving}
          loadingText="Adding…"
        >
          Add
        </Button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </form>
  );
}
