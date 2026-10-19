import type { CreateTaskInput, IUser } from '@tbot/shared';
import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_TYPE,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_ORDER,
  TASK_TYPE_HINTS,
  TASK_TYPE_LABELS,
  TASK_TYPE_ORDER,
  TaskPriority,
  TaskType,
} from '@tbot/shared';
import { type FormEvent, useEffect, useState } from 'react';

import { buttonPrimary, fieldInput, fieldLabel } from '@/components/ui/state';
import { displayName } from '@/lib/user';

interface CreateTaskModalProps {
  isOpen: boolean;
  members: IUser[];
  onClose: () => void;
  /** Resolves to null on success, or an error message to show. */
  onSubmit: (input: CreateTaskInput) => Promise<string | null>;
  isLoading?: boolean;
}

export function CreateTaskModal({ isOpen, members, onClose, onSubmit, isLoading }: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TaskType>(DEFAULT_TASK_TYPE);
  const [priority, setPriority] = useState<TaskPriority>(DEFAULT_TASK_PRIORITY);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isLoading) return;
    setError(null);
    const message = await onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      priority,
      assigneeId: assigneeId || undefined,
      dueDate: dueDate || undefined,
    });
    if (message) {
      setError(message); // keep everything the user typed
      return;
    }
    setTitle('');
    setDescription('');
    setType(DEFAULT_TASK_TYPE);
    setPriority(DEFAULT_TASK_PRIORITY);
    setAssigneeId('');
    setDueDate('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal aria-labelledby="create-task-title">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="pb-safe relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-tg-section px-5 pt-4 shadow-xl sm:rounded-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="create-task-title" className="text-lg font-semibold text-tg-text">
            Create task
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-xl text-tg-hint active:bg-tg-secondary"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="new-type" className={fieldLabel}>
              Type
            </label>
            <select id="new-type" value={type} onChange={(e) => setType(e.target.value as TaskType)} className={`${fieldInput} sm:w-1/2`}>
              {TASK_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-tg-hint">{TASK_TYPE_HINTS[type]}</p>
          </div>

          <div>
            <label htmlFor="new-title" className={fieldLabel}>
              Summary <span className="text-tg-destructive">*</span>
            </label>
            <input
              id="new-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              autoFocus
              className={fieldInput}
            />
          </div>

          <div>
            <label htmlFor="new-description" className={fieldLabel}>
              Description
            </label>
            <textarea
              id="new-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={2000}
              className={`${fieldInput} resize-y py-2.5`}
            />
          </div>

          <div>
            <label htmlFor="new-assignee" className={fieldLabel}>
              Assignee
            </label>
            <select id="new-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={fieldInput}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m._id} value={m._id}>
                  {displayName(m)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-priority" className={fieldLabel}>
                Priority
              </label>
              <select
                id="new-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className={fieldInput}
              >
                {TASK_PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="new-due" className={fieldLabel}>
                Due date
              </label>
              <input id="new-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldInput} />
            </div>
          </div>

          {error && (
            <p role="alert" className="tint-danger rounded-xl p-3 text-sm">
              {error}
            </p>
          )}

          <button type="submit" disabled={!title.trim() || isLoading} className={`${buttonPrimary} w-full sm:ml-auto sm:w-auto`}>
            {isLoading ? 'Creating…' : 'Create'}
          </button>
        </form>
      </div>
    </div>
  );
}
