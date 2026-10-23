import type { EpicWithProgress, IUser, TaskDueFilter } from '@tbot/shared';
import {
  EpicStatus,
  TASK_STATUS_CATEGORY_LABELS,
  TASK_STATUS_HINTS,
  TASK_STATUS_LABELS,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@tbot/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { EpicDot } from '@/components/epics/epic-chip';
import { Avatar, splitLabel, statusText } from '@/components/ui/badges';
import { type SelectOption, type SelectSection, SelectMenu } from '@/components/ui/select-menu';
import { PRIORITY_OPTIONS, STATUS_CATEGORIES, statusesIn, TYPE_OPTIONS } from '@/components/ui/task-options';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { formatEpicProgress } from '@/lib/epics';
import { displayName } from '@/lib/user';

import { type BoardGroupBy, type BoardSearch, type BoardView, type StatusCategoryFilter, subtasksHidden } from '../board-search';

const VISIBLE_AVATARS = 5;

const DUE_OPTIONS: SelectOption<TaskDueFilter>[] = [
  { value: 'overdue', label: 'Overdue', icon: '⚠️', hint: 'Past the due date and not done' },
  { value: 'today', label: 'Due today', icon: '📅', hint: "Due on today's date" },
  { value: 'week', label: 'Due this week', icon: '🗓', hint: 'Today and the next 6 days' },
  { value: 'none', label: 'No due date', icon: '∅', hint: 'Tasks without a due date' },
];

/** Status filter values are encoded: `cat:<category|open>` or `s:<status>`. */
const STATUS_FILTER_SECTIONS: SelectSection<string>[] = [
  {
    label: 'Status groups',
    options: [
      { value: 'cat:open', label: 'Open', icon: '📂', hint: 'Not done or cancelled' },
      ...STATUS_CATEGORIES.map((c) => {
        const { icon, text } = splitLabel(TASK_STATUS_CATEGORY_LABELS[c]);
        return {
          value: `cat:${c}`,
          label: `All ${text.toLocaleLowerCase()}`,
          icon,
          hint: statusesIn(c).map(statusText).join(', '),
        };
      }),
    ],
  },
  ...STATUS_CATEGORIES.map((c) => ({
    label: splitLabel(TASK_STATUS_CATEGORY_LABELS[c]).text,
    options: statusesIn(c).map((s) => {
      const { icon, text } = splitLabel(TASK_STATUS_LABELS[s]);
      return { value: `s:${s}`, label: text, icon, hint: TASK_STATUS_HINTS[s] };
    }),
  })),
];

const NO_EPIC_OPTION: SelectOption<string> = {
  value: 'none',
  label: 'No epic',
  icon: <span className="text-tg-hint">∅</span>,
  hint: 'Tasks not in any epic',
};

function epicSections(epics: EpicWithProgress[], selected?: string, isLoading = false): SelectSection<string>[] {
  const toOption = (e: EpicWithProgress): SelectOption<string> => ({
    value: e._id,
    label: e.title,
    icon: <EpicDot color={e.color} className="h-2.5 w-2.5" />,
    hint: formatEpicProgress(e).short,
  });
  const open = epics.filter((e) => e.status === EpicStatus.OPEN).map(toOption);
  const done = epics.filter((e) => e.status === EpicStatus.DONE).map(toOption);
  const sections: SelectSection<string>[] = [{ options: [NO_EPIC_OPTION] }];
  if (open.length) sections.push({ label: 'Open epics', options: open });
  if (done.length) sections.push({ label: 'Done', options: done });
  // The selected epic isn't in the list: still loading → a neutral "Epic" placeholder; loaded → it was deleted
  // (the board clears that filter itself — this only keeps the chip readable meanwhile).
  if (selected && selected !== 'none' && !epics.some((e) => e._id === selected)) {
    sections.push({
      options: [
        isLoading
          ? {
              value: selected,
              label: 'Epic',
              icon: <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-current opacity-40" />,
              hint: 'Loading…',
            }
          : { value: selected, label: 'Deleted epic', icon: '∅' },
      ],
    });
  }
  return sections;
}

function encodeStatus(search: BoardSearch): string {
  if (search.category) return `cat:${search.category}`;
  if (search.status) return `s:${search.status}`;
  return '';
}

function decodeStatus(value: string): Pick<BoardSearch, 'status' | 'category'> {
  if (value.startsWith('cat:')) return { category: value.slice(4) as StatusCategoryFilter, status: undefined };
  if (value.startsWith('s:')) return { status: value.slice(2) as TaskStatus, category: undefined };
  return { status: undefined, category: undefined };
}

interface TaskFiltersBarProps {
  search: BoardSearch;
  view: BoardView;
  groupBy: BoardGroupBy;
  members: IUser[];
  epics: EpicWithProgress[];
  /** The epic list hasn't loaded yet — don't call a selected epic "deleted". */
  epicsLoading?: boolean;
  onChange: (patch: Partial<BoardSearch>, options?: { replace?: boolean }) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  /** Group-wide open tasks past their due day; shown as a shortcut to the Overdue filter. */
  overdueCount?: number;
}

export function TaskFiltersBar({
  search,
  view,
  groupBy,
  members,
  epics,
  epicsLoading = false,
  onChange,
  onClear,
  hasActiveFilters,
  overdueCount = 0,
}: TaskFiltersBarProps) {
  const hideSubtasks = subtasksHidden(search, view);
  // Search is typed locally and pushed to the URL after 300ms.
  const [text, setText] = useState(search.q ?? '');
  const lastPushed = useRef(search.q ?? '');

  useEffect(() => {
    // URL changed from outside (Clear filters, back button) → reflect it.
    if ((search.q ?? '') !== lastPushed.current) {
      lastPushed.current = search.q ?? '';
      setText(search.q ?? '');
    }
  }, [search.q]);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === lastPushed.current) return;
    const id = window.setTimeout(() => {
      lastPushed.current = trimmed;
      onChange({ q: trimmed || undefined }, { replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [text, onChange]);

  const mine = search.assignee === 'me';
  const visibleMembers = members.slice(0, VISIBLE_AVATARS);
  const overflow = members.slice(VISIBLE_AVATARS);
  const overflowSelected = overflow.find((m) => m._id === search.assignee);

  const toggleAssignee = (id: string) => onChange({ assignee: search.assignee === id ? undefined : id });

  return (
    <div className="flex flex-col gap-2 px-4 pb-2 pt-3">
      {/* View controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<BoardView>
          ariaLabel="View"
          value={view}
          onChange={(v) => onChange({ view: v })}
          options={[
            { value: 'board', label: '▦ Board' },
            { value: 'list', label: '☰ List' },
          ]}
        />
        {view === 'board' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-tg-hint">Group by</span>
            <Segmented<BoardGroupBy>
              ariaLabel="Group by"
              value={groupBy}
              onChange={(g) => onChange({ groupBy: g })}
              options={[
                { value: 'status', label: 'Status' },
                { value: 'assignee', label: 'Assignee' },
              ]}
            />
          </div>
        )}
        {overdueCount > 0 && search.due !== 'overdue' && (
          <button
            type="button"
            onClick={() => onChange({ due: 'overdue' })}
            aria-label={`Show the ${overdueCount} overdue task${overdueCount === 1 ? '' : 's'} in this view`}
            className="focus-ring ml-auto inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-tg-destructive transition-colors hover:bg-tg-secondary"
          >
            <span aria-hidden>⚠️</span> {overdueCount} overdue <span aria-hidden>›</span>
          </button>
        )}
      </div>

      {/* Jira-style filter bar: search on its own row on phones, chips scroll horizontally. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-tg-separator bg-tg-section px-3 transition-colors focus-within:border-tg-link sm:w-60">
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-tg-hint" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search tasks or #12"
            aria-label="Search by title, description or #number"
            className="min-w-0 flex-1 bg-transparent text-sm text-tg-text outline-none placeholder:text-tg-hint"
            enterKeyHint="search"
          />
        </label>

        <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {members.length > 0 && (
            <div role="group" aria-label="Filter by assignee" className="-ml-2 flex shrink-0 items-center">
              {visibleMembers.map((m) => (
                <AvatarFilter
                  key={m._id}
                  active={search.assignee === m._id}
                  label={displayName(m)}
                  onClick={() => toggleAssignee(m._id)}
                >
                  <Avatar user={m} size="md" />
                </AvatarFilter>
              ))}
              <AvatarFilter
                active={search.assignee === 'none'}
                label="Unassigned"
                onClick={() => toggleAssignee('none')}
              >
                <Avatar user={null} size="md" className="bg-tg-bg" />
              </AvatarFilter>
              {overflow.length > 0 && (
                <SelectMenu<string>
                  variant="chip"
                  title="Assignee"
                  placeholder={`+${overflow.length}`}
                  triggerLabel={
                    overflowSelected
                      ? `Assignee: ${displayName(overflowSelected)}`
                      : `${overflow.length} more assignees`
                  }
                  value={overflowSelected?._id ?? null}
                  onChange={(v) => onChange({ assignee: v ?? undefined })}
                  clearOption={{ label: 'Anyone' }}
                  options={overflow.map((m) => ({ value: m._id, label: displayName(m), icon: <Avatar user={m} /> }))}
                  searchPlaceholder="Search people"
                  triggerClassName="ml-1"
                />
              )}
            </div>
          )}

          {(epics.length > 0 || search.epic) && (
            <SelectMenu<string>
              variant="chip"
              title="Epic"
              placeholder="Epic"
              value={search.epic}
              onChange={(v) => onChange({ epic: v ?? undefined })}
              clearOption={{ label: 'All epics' }}
              sections={epicSections(epics, search.epic, epicsLoading)}
              searchPlaceholder="Search epics"
              menuWidth={280}
            />
          )}

          <SelectMenu<TaskType>
            variant="chip"
            title="Type"
            placeholder="Type"
            value={search.type}
            onChange={(v) => onChange({ type: v ?? undefined })}
            clearOption={{ label: 'All types' }}
            options={TYPE_OPTIONS}
            menuWidth={300}
          />

          <SelectMenu<TaskPriority>
            variant="chip"
            title="Priority"
            placeholder="Priority"
            value={search.priority}
            onChange={(v) => onChange({ priority: v ?? undefined })}
            clearOption={{ label: 'Any priority' }}
            options={PRIORITY_OPTIONS}
          />

          <SelectMenu<TaskDueFilter>
            variant="chip"
            title="Due"
            placeholder="Due"
            value={search.due}
            onChange={(v) => onChange({ due: v ?? undefined })}
            clearOption={{ label: 'Any due date' }}
            options={DUE_OPTIONS}
            searchable={false}
            menuWidth={260}
          />

          {view === 'list' && (
            <SelectMenu<string>
              variant="chip"
              title="Status"
              placeholder="Status"
              value={encodeStatus(search) || null}
              onChange={(v) => onChange(decodeStatus(v ?? ''))}
              clearOption={{ label: 'Any status' }}
              sections={STATUS_FILTER_SECTIONS}
              searchable={false}
              menuWidth={280}
            />
          )}

          <Button
            variant={mine ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={mine}
            onClick={() => onChange({ assignee: mine ? undefined : 'me' })}
          >
            My tasks
          </Button>

          {view === 'board' ? (
            <Button
              variant={!hideSubtasks ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={!hideSubtasks}
              title="Show subtasks as their own cards"
              onClick={() => onChange({ subtasks: hideSubtasks ? 'show' : undefined })}
            >
              Show subtasks
            </Button>
          ) : (
            <Button
              variant={hideSubtasks ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={hideSubtasks}
              title="Show only top-level tasks"
              onClick={() => onChange({ subtasks: hideSubtasks ? undefined : 'hide' })}
            >
              Hide subtasks
            </Button>
          )}

          {hasActiveFilters && (
            <Button variant="link" size="sm" onClick={onClear}>
              Clear filters
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function AvatarFilter({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Only ${label}`}
      title={label}
      onClick={onClick}
      className={`focus-ring flex h-11 w-11 items-center justify-center rounded-full ${active ? 'z-10' : ''}`}
    >
      <span
        className={`rounded-full ring-2 transition-transform ${
          active ? 'scale-110 ring-tg-link' : 'ring-tg-bg hover:-translate-y-0.5'
        }`}
      >
        {children}
      </span>
    </button>
  );
}
