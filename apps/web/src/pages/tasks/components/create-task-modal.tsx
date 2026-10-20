import type { CreateTaskInput, EpicWithProgress, IEpic, IUser } from '@tbot/shared';
import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_TYPE,
  EpicStatus,
  TASK_TYPE_HINTS,
  TaskPriority,
  TaskType,
} from '@tbot/shared';
import { type FormEvent, useEffect, useState } from 'react';

import type { EpicFormValues } from '@/components/epics/epic-form-dialog';
import { EpicPicker } from '@/components/epics/epic-picker';
import { SelectMenu } from '@/components/ui/select-menu';
import { PRIORITY_OPTIONS, TYPE_OPTIONS } from '@/components/ui/task-options';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorBox, FormField, Input, Textarea } from '@/components/ui/input';

import { AssigneePicker } from '../../task-detail/components/assignee-picker';

interface CreateTaskModalProps {
  isOpen: boolean;
  members: IUser[];
  epics: EpicWithProgress[];
  /** Pre-selected epic (the board is filtered to it) — may be a done epic; the field then says so. */
  defaultEpicId?: string;
  onCreateEpic?: (values: EpicFormValues) => Promise<IEpic | string>;
  isCreatingEpic?: boolean;
  onClose: () => void;
  /** Resolves to null on success, or an error message to show. */
  onSubmit: (input: CreateTaskInput) => Promise<string | null>;
  isLoading?: boolean;
}

export function CreateTaskModal({
  isOpen,
  members,
  epics,
  defaultEpicId,
  onCreateEpic,
  isCreatingEpic,
  onClose,
  onSubmit,
  isLoading,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TaskType>(DEFAULT_TASK_TYPE);
  const [priority, setPriority] = useState<TaskPriority>(DEFAULT_TASK_PRIORITY);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [epicId, setEpicId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Each time it opens, start in the epic the board is filtered to.
  useEffect(() => {
    if (isOpen) setEpicId(defaultEpicId ?? '');
  }, [isOpen, defaultEpicId]);

  if (!isOpen) return null;

  const selectedEpicDone = !!epicId && epics.find((e) => e._id === epicId)?.status === EpicStatus.DONE;

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
      epicId: epicId || undefined,
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
    setEpicId('');
  };

  return (
    <Dialog title="Create task" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField label="Type" htmlFor="new-type" hint={TASK_TYPE_HINTS[type]}>
          <div className="sm:w-1/2">
            <SelectMenu<TaskType>
              id="new-type"
              variant="field"
              appearance="input"
              title="Type"
              value={type}
              onChange={(t) => t && setType(t)}
              options={TYPE_OPTIONS}
              menuWidth={300}
            />
          </div>
        </FormField>

        <FormField label="Summary" htmlFor="new-title" required>
          <Input
            id="new-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            autoFocus
          />
        </FormField>

        <FormField label="Description" htmlFor="new-description">
          <Textarea
            id="new-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={2000}
          />
        </FormField>

        <FormField label="Assignee" htmlFor="new-assignee">
          <AssigneePicker
            id="new-assignee"
            appearance="input"
            members={members}
            assignee={assigneeId || null}
            onSelect={(id) => setAssigneeId(id ?? '')}
          />
        </FormField>

        {(epics.length > 0 || onCreateEpic) && (
          <FormField
            label="Epic"
            htmlFor="new-epic"
            hint={selectedEpicDone ? 'This epic is marked done — the task is still added to it.' : undefined}
          >
            <EpicPicker
              id="new-epic"
              appearance="input"
              epics={epics}
              value={epicId || null}
              onSelect={(epic) => setEpicId(epic?._id ?? '')}
              onCreateEpic={onCreateEpic}
              isCreating={isCreatingEpic}
            />
          </FormField>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Priority" htmlFor="new-priority">
            <SelectMenu<TaskPriority>
              id="new-priority"
              variant="field"
              appearance="input"
              title="Priority"
              value={priority}
              onChange={(p) => p && setPriority(p)}
              options={PRIORITY_OPTIONS}
            />
          </FormField>
          <FormField label="Due date" htmlFor="new-due">
            <Input id="new-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormField>
        </div>

        {error && <ErrorBox>{error}</ErrorBox>}

        <Button
          type="submit"
          variant="primary"
          disabled={!title.trim()}
          loading={isLoading}
          loadingText="Creating…"
          className="w-full sm:ml-auto sm:w-auto"
        >
          Create
        </Button>
      </form>
    </Dialog>
  );
}
