import type { IUser } from '@tbot/shared';
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TASK_TYPE_HINTS,
  TASK_TYPE_LABELS,
  TASK_TYPE_ORDER,
  TaskPriority,
  TaskStatus,
  TaskStatusCategory,
  TaskType,
} from '@tbot/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/badges';
import { buttonLink } from '@/components/ui/state';
import { displayName } from '@/lib/user';

import type { BoardGroupBy, BoardSearch, BoardView, StatusCategoryFilter } from '../board-search';

const VISIBLE_AVATARS = 5;

const CATEGORY_LABELS: Record<StatusCategoryFilter, string> = {
  open: 'Open (not done or cancelled)',
  [TaskStatusCategory.TODO]: `${TASK_STATUS_CATEGORY_LABELS[TaskStatusCategory.TODO]} (all)`,
  [TaskStatusCategory.IN_PROGRESS]: `${TASK_STATUS_CATEGORY_LABELS[TaskStatusCategory.IN_PROGRESS]} (all)`,
  [TaskStatusCategory.DONE]: `${TASK_STATUS_CATEGORY_LABELS[TaskStatusCategory.DONE]} (all)`,
};
const CATEGORY_ORDER: StatusCategoryFilter[] = [
  'open',
  TaskStatusCategory.TODO,
  TaskStatusCategory.IN_PROGRESS,
  TaskStatusCategory.DONE,
];

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
  onChange: (patch: Partial<BoardSearch>, options?: { replace?: boolean }) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
}

export function TaskFiltersBar({ search, view, groupBy, members, onChange, onClear, hasActiveFilters }: TaskFiltersBarProps) {
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
      </div>

      {/* Jira-style filter bar */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <label className="flex min-h-11 w-full items-center rounded-lg border border-tg-separator bg-tg-section focus-within:border-tg-link sm:w-64">
          <span className="pl-3 pr-2 text-xs font-medium text-tg-hint">Search</span>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Title, description or #number"
            className="min-w-0 flex-1 bg-transparent py-2 pr-3 text-sm text-tg-text outline-none placeholder:text-tg-hint/80"
            enterKeyHint="search"
          />
        </label>

        {members.length > 0 && (
          <div role="group" aria-label="Filter by assignee" className="flex items-center pl-1">
            {visibleMembers.map((m) => (
              <AvatarFilter key={m._id} active={search.assignee === m._id} label={displayName(m)} onClick={() => toggleAssignee(m._id)}>
                <Avatar user={m} size="md" />
              </AvatarFilter>
            ))}
            <AvatarFilter active={search.assignee === 'none'} label="Unassigned" onClick={() => toggleAssignee('none')}>
              <Avatar user={null} size="md" className="bg-tg-bg" />
            </AvatarFilter>
            {overflow.length > 0 && (
              <ChipSelect
                label={overflowSelected ? displayName(overflowSelected) : `+${overflow.length}`}
                ariaLabel="More assignees"
                active={!!overflowSelected}
                value={overflowSelected?._id ?? ''}
                onChange={(v) => onChange({ assignee: v || undefined })}
                className="ml-2"
              >
                <option value="">Anyone</option>
                {overflow.map((m) => (
                  <option key={m._id} value={m._id}>
                    {displayName(m)}
                  </option>
                ))}
              </ChipSelect>
            )}
          </div>
        )}

        <ChipSelect
          label={search.type ? TASK_TYPE_LABELS[search.type] : 'Type'}
          ariaLabel="Type"
          active={!!search.type}
          value={search.type ?? ''}
          onChange={(v) => onChange({ type: (v as TaskType) || undefined })}
        >
          <option value="">All types</option>
          {TASK_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TASK_TYPE_LABELS[t]} — {TASK_TYPE_HINTS[t]}
            </option>
          ))}
        </ChipSelect>

        <ChipSelect
          label={search.priority ? TASK_PRIORITY_LABELS[search.priority] : 'Priority'}
          ariaLabel="Priority"
          active={!!search.priority}
          value={search.priority ?? ''}
          onChange={(v) => onChange({ priority: (v as TaskPriority) || undefined })}
        >
          <option value="">Any priority</option>
          {TASK_PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {TASK_PRIORITY_LABELS[p]}
            </option>
          ))}
        </ChipSelect>

        {view === 'list' && (
          <ChipSelect
            label={
              search.category
                ? CATEGORY_LABELS[search.category].replace(' (all)', '').replace(' (not done or cancelled)', '')
                : search.status
                  ? TASK_STATUS_LABELS[search.status]
                  : 'Status'
            }
            ariaLabel="Status"
            active={!!(search.status || search.category)}
            value={encodeStatus(search)}
            onChange={(v) => onChange(decodeStatus(v))}
          >
            <option value="">Any status</option>
            <optgroup label="Groups">
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={`cat:${c}`}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Statuses">
              {TASK_STATUS_ORDER.map((s) => (
                <option key={s} value={`s:${s}`}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </optgroup>
          </ChipSelect>
        )}

        <button
          type="button"
          aria-pressed={mine}
          onClick={() => onChange({ assignee: mine ? undefined : 'me' })}
          className={`min-h-11 rounded-lg px-3 text-sm font-medium transition-colors ${
            mine ? 'bg-tg-button text-tg-button-text' : 'text-tg-text hover:bg-tg-secondary active:bg-tg-secondary'
          }`}
        >
          Only my issues
        </button>

        {hasActiveFilters && (
          <button type="button" onClick={onClear} className={buttonLink}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-lg bg-tg-secondary p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 rounded-md px-3 text-sm font-medium transition-colors ${
            value === o.value ? 'bg-tg-section text-tg-text shadow-sm' : 'text-tg-hint'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AvatarFilter({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Only ${label}`}
      title={label}
      onClick={onClick}
      className={`-ml-1 flex h-11 w-8 items-center justify-center first:ml-0 ${active ? 'z-10' : ''}`}
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

/** Jira-like "Label ▾" chip backed by a native select (accessible, native picker on phones). */
function ChipSelect({
  label,
  ariaLabel,
  active,
  value,
  onChange,
  children,
  className = '',
}: {
  label: string;
  ariaLabel: string;
  active: boolean;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`relative inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-3 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-tg-link ${
        active ? 'tint-link' : 'text-tg-text hover:bg-tg-secondary'
      } ${className}`}
    >
      <span className="max-w-[160px] truncate">{label}</span>
      <span aria-hidden className="text-xs opacity-70">
        ▾
      </span>
      <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        {children}
      </select>
    </label>
  );
}
