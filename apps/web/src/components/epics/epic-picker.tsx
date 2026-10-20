import type { EpicWithProgress, IEpic, ITask } from '@tbot/shared';
import { EpicStatus } from '@tbot/shared';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { type SelectOption, type SelectSection, SelectMenu } from '@/components/ui/select-menu';
import { formatEpicProgress, getEpicId, resolveEpic } from '@/lib/epics';

import { EpicDot } from './epic-chip';
import { type EpicFormValues, EpicFormDialog } from './epic-form-dialog';

const NEW_EPIC = '__new_epic';

interface EpicPickerProps {
  id: string;
  epics: EpicWithProgress[];
  /** The task's current epic (populated or bare id). */
  value: ITask['epicId'];
  onSelect: (epic: IEpic | EpicWithProgress | null) => void;
  /** Creates an epic inline; resolves to it, or an error message. */
  onCreateEpic?: (values: EpicFormValues) => Promise<IEpic | string>;
  isCreating?: boolean;
  disabled?: boolean;
  /** `input` = bordered form field (create modal); `ghost` = detail panel. */
  appearance?: 'ghost' | 'input';
}

function progressHint(epic: EpicWithProgress): string {
  return formatEpicProgress(epic).short;
}

/** Epic field: every open epic, "No epic", and "＋ New epic…" which opens the create sheet. */
export function EpicPicker({
  id,
  epics,
  value,
  onSelect,
  onCreateEpic,
  isCreating,
  disabled,
  appearance = 'ghost',
}: EpicPickerProps) {
  const [creating, setCreating] = useState(false);
  const currentId = getEpicId(value);
  const current = resolveEpic(value, epics);

  const open = epics.filter((e) => e.status === EpicStatus.OPEN);
  const toOption = (e: { _id: string; title: string; color: string }, hint?: string): SelectOption<string> => ({
    value: e._id,
    label: e.title,
    icon: <EpicDot color={e.color} className="h-2.5 w-2.5" />,
    hint,
  });

  const sections: SelectSection<string>[] = [{ options: open.map((e) => toOption(e, progressHint(e))) }];
  // Keep a done (or not-yet-loaded) current epic visible so the field shows its name.
  if (current && !open.some((e) => e._id === current._id)) {
    sections.push({
      label: current.status === EpicStatus.DONE ? 'Done' : undefined,
      options: [toOption(current, current.status === EpicStatus.DONE ? 'This epic is marked done' : undefined)],
    });
  }
  if (onCreateEpic) {
    sections.push({
      options: [
        {
          value: NEW_EPIC,
          label: 'New epic…',
          icon: <span className="text-lg font-semibold leading-none text-tg-link">＋</span>,
          hint: open.length === 0 ? 'Group related tasks under one goal' : undefined,
        },
      ],
    });
  }

  const handleCreate = async (values: EpicFormValues): Promise<string | null> => {
    if (!onCreateEpic) return null;
    const result = await onCreateEpic(values);
    if (typeof result === 'string') return result;
    setCreating(false);
    onSelect(result);
    return null;
  };

  return (
    <>
      <SelectMenu<string>
        id={id}
        variant="field"
        appearance={appearance}
        title="Epic"
        value={currentId}
        onChange={(v) => {
          if (v === NEW_EPIC) {
            setCreating(true);
            return;
          }
          onSelect(v ? (epics.find((e) => e._id === v) ?? null) : null);
        }}
        disabled={disabled}
        clearOption={{ label: 'No epic', icon: <span className="text-tg-hint">∅</span> }}
        sections={sections}
        searchPlaceholder="Search epics"
      />
      {creating &&
        createPortal(
          <EpicFormDialog
            existing={epics}
            onClose={() => setCreating(false)}
            onSubmit={handleCreate}
            isSaving={isCreating}
          />,
          document.body,
        )}
    </>
  );
}
