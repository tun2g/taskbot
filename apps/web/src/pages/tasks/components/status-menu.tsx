import type { ITask } from '@tbot/shared';
import type { TaskStatus } from '@tbot/shared';

import { SelectMenu } from '@/components/ui/select-menu';
import { STATUS_SECTIONS } from '@/components/ui/task-options';

/**
 * ⋯ "Move to…" menu — the non-drag way to change status. Stops events so the card behind it
 * doesn't open or start a drag.
 */
export function StatusMenu({ task, onChange }: { task: ITask; onChange: (task: ITask, status: TaskStatus) => void }) {
  return (
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <SelectMenu<TaskStatus>
        variant="custom"
        menuRole="menu"
        title={`Move #${task.taskNumber} to`}
        triggerLabel={`Move #${task.taskNumber} to another status`}
        value={task.status}
        onChange={(s) => s && onChange(task, s)}
        sections={STATUS_SECTIONS}
        searchable={false}
        align="end"
        menuWidth={260}
        triggerClassName="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-tg-hint transition-colors hover:bg-tg-secondary hover:text-tg-text"
      >
        <span aria-hidden title="Move to…">
          ⋯
        </span>
      </SelectMenu>
    </span>
  );
}
