import type { ITask, TaskStatus } from '@tbot/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SelectMenu, type SelectSection } from '@/components/ui/select-menu';
import { STATUS_SECTIONS } from '@/components/ui/task-options';

import { ParentPicker } from './parent-picker';

const MOVE = 'action:move';
const DETACH = 'action:detach';

interface SubtaskRowMenuProps {
  groupId: string;
  task: ITask;
  parentNumber: number;
  onStatusChange: (task: ITask, status: TaskStatus) => void;
  /** Another parent, or null to make it a regular task. */
  onParentChange: (task: ITask, parent: ITask | null) => void;
}

/** ⋯ on a subtask row: change its status, move it under another task, or take it out of this one. */
export function SubtaskRowMenu({ groupId, task, parentNumber, onStatusChange, onParentChange }: SubtaskRowMenuProps) {
  const [moving, setMoving] = useState(false);
  const sections: SelectSection<string>[] = [
    ...STATUS_SECTIONS,
    {
      label: 'Subtask',
      options: [
        { value: MOVE, label: 'Move under another task…', icon: '↗' },
        { value: DETACH, label: `Remove from #${parentNumber}`, icon: '⤴', hint: 'It stays as a regular task' },
      ],
    },
  ];

  return (
    <>
      <SelectMenu<string>
        variant="custom"
        menuRole="menu"
        title={`#${task.taskNumber}`}
        triggerLabel={`Actions for #${task.taskNumber}`}
        value={task.status}
        onChange={(v) => {
          if (v === MOVE) setMoving(true);
          else if (v === DETACH) onParentChange(task, null);
          else if (v) onStatusChange(task, v as TaskStatus);
        }}
        sections={sections}
        searchable={false}
        align="end"
        menuWidth={280}
        triggerClassName="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-tg-hint transition-colors hover:bg-tg-secondary hover:text-tg-text active:bg-tg-secondary"
      >
        <span aria-hidden>⋯</span>
      </SelectMenu>

      {moving && (
        <Dialog
          size="sm"
          title={`Move #${task.taskNumber} under another task`}
          description="Pick an open task. If it's in another epic, this subtask moves to that epic too."
          onClose={() => setMoving(false)}
          footer={<Button onClick={() => setMoving(false)}>Cancel</Button>}
        >
          <ParentPicker
            groupId={groupId}
            task={task}
            title={`Move #${task.taskNumber} under`}
            placeholder="Pick a task"
            appearance="input"
            onPick={(parent) => {
              setMoving(false);
              onParentChange(task, parent);
            }}
          />
        </Dialog>
      )}
    </>
  );
}
