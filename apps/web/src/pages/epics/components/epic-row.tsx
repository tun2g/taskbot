import type { EpicWithProgress, TaskStatusCategory } from '@tbot/shared';
import { EpicStatus } from '@tbot/shared';

import { SelectMenu } from '@/components/ui/select-menu';
import { epicColorClasses, formatEpicProgress } from '@/lib/epics';

type EpicAction = 'edit' | 'toggle' | 'delete';

interface EpicRowProps {
  epic: EpicWithProgress;
  /** No category → every task of the epic (status board, all columns); a category → list view of just those. */
  onOpen: (epic: EpicWithProgress, category?: TaskStatusCategory | 'open') => void;
  onEdit: (epic: EpicWithProgress) => void;
  onToggleDone: (epic: EpicWithProgress) => void;
  onDelete: (epic: EpicWithProgress) => void;
}

/**
 * One epic: color, name, progress bar and counts. Tap the row → all its tasks; tap "2 in progress" → just those,
 * so the numbers here always match what the board shows. ⋯ → actions.
 */
export function EpicRow({ epic, onOpen, onEdit, onToggleDone, onDelete }: EpicRowProps) {
  const progress = formatEpicProgress(epic);
  const { total, done, inProgress, pct } = progress;
  const isDone = epic.status === EpicStatus.DONE;
  const color = epicColorClasses(epic.color);

  return (
    <li className="flex items-start">
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => onOpen(epic)}
          aria-label={`${epic.title}: ${progress.summary}. Show all its tasks`}
          className="flex min-w-0 gap-3 pb-1.5 pl-4 pr-1 pt-3 text-left transition-colors hover:bg-tg-secondary/50 active:bg-tg-secondary"
        >
          <span
            aria-hidden
            className={`mt-1 h-3 w-3 shrink-0 rounded-full ${color.solid} ${isDone ? 'opacity-60' : ''}`}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-start gap-2">
              <span
                className={`line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold leading-snug [overflow-wrap:anywhere] ${
                  isDone ? 'text-tg-hint line-through decoration-tg-hint/60' : 'text-tg-text'
                }`}
              >
                {epic.title}
              </span>
              {isDone ? (
                <span className="flex shrink-0 items-center gap-1">
                  {progress.open > 0 && (
                    <span className="lozenge lozenge-todo">{progress.open} still open</span>
                  )}
                  <span className="lozenge lozenge-done">Done</span>
                </span>
              ) : (
                total > 0 && (
                  <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-tg-text">
                    {progress.pctLabel}
                  </span>
                )
              )}
            </span>
            {epic.description && <span className="line-clamp-1 text-xs text-tg-hint">{epic.description}</span>}
            <span
              role="progressbar"
              aria-label={`${epic.title}: ${progress.pctLabel || 'no tasks yet'}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="flex h-1.5 w-full overflow-hidden rounded-full bg-tg-secondary"
            >
              {total > 0 && (
                <>
                  <span className={`h-full ${color.solid}`} style={{ width: `${(done / total) * 100}%` }} />
                  <span
                    className={`h-full ${color.solid} opacity-35`}
                    style={{ width: `${(inProgress / total) * 100}%` }}
                  />
                </>
              )}
            </span>
          </span>
          <span aria-hidden className="self-center pl-1 text-lg text-tg-hint">
            ›
          </span>
        </button>

        {/* Each count is its own link to exactly those tasks. */}
        <span className="flex flex-wrap items-center pb-1.5 pl-[2.375rem] pr-2 text-xs tabular-nums text-tg-hint">
          {progress.segments.length === 0 ? (
            <span className="py-1.5 pl-1">No tasks yet</span>
          ) : (
            progress.segments.map((segment, i) => (
              <span key={segment.category} className="flex items-center">
                {i > 0 && <span aria-hidden>·</span>}
                <button
                  type="button"
                  onClick={() => onOpen(epic, segment.category)}
                  aria-label={`Show ${segment.label} in ${epic.title}`}
                  className="focus-ring min-h-11 rounded px-1.5 underline-offset-2 transition-colors hover:text-tg-link hover:underline active:text-tg-link sm:min-h-8"
                >
                  {segment.label}
                </button>
              </span>
            ))
          )}
        </span>
      </div>

      <span className="flex items-center pr-1 pt-1.5">
        <SelectMenu<EpicAction>
          variant="custom"
          menuRole="menu"
          title={epic.title}
          triggerLabel={`More actions for ${epic.title}`}
          value={null}
          onChange={(action) => {
            if (action === 'edit') onEdit(epic);
            else if (action === 'toggle') onToggleDone(epic);
            else if (action === 'delete') onDelete(epic);
          }}
          options={[
            { value: 'edit', label: 'Edit', icon: '✏️', hint: 'Name, description, color' },
            isDone
              ? { value: 'toggle', label: 'Reopen', icon: '↩️', hint: 'Move back to open epics' }
              : { value: 'toggle', label: 'Mark as done', icon: '✅', hint: 'Its tasks stay as they are' },
            { value: 'delete', label: 'Delete epic', icon: '🗑', hint: 'Tasks are kept, just leave the epic' },
          ]}
          searchable={false}
          align="end"
          menuWidth={240}
          triggerClassName="flex h-11 w-11 items-center justify-center rounded-full text-lg text-tg-hint transition-colors hover:bg-tg-secondary hover:text-tg-text"
        >
          <span aria-hidden>⋯</span>
        </SelectMenu>
      </span>
    </li>
  );
}
