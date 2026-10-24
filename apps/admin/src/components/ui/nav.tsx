import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';

import { Button } from './button';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
  hint?: string;
}

/** Underlined tabs (status tabs, detail tabs). Scrolls sideways on small screens. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            title={item.hint}
            onClick={() => onChange(item.value)}
            className={cn(
              '-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 border-b-[3px] px-3 py-2.5 text-[15px] whitespace-nowrap transition-colors',
              active ? 'border-brand font-bold text-accent-text' : 'border-transparent text-text-2 hover:text-accent-text',
            )}
          >
            {item.label}
            {item.count != null && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[13px] leading-none tabular',
                  active ? 'bg-brand-soft font-bold text-accent-text' : 'bg-neutral-soft text-text-3',
                )}
              >
                {formatNumber(item.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control for small option sets (range, group-by). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'cursor-pointer rounded-md font-bold whitespace-nowrap transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-[13px]' : 'px-3 py-1.5 text-sm',
            o.value === value ? 'bg-brand-soft text-accent-text' : 'text-text-2 hover:text-accent-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  limit,
  total,
  onPage,
  noun,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
  noun: string;
}) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3.5 text-sm text-text-2">
      <span className="tabular">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)} {noun}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
            Previous
          </Button>
          <span className="tabular">
            Page {page} of {pages}
          </span>
          <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/** A removable filter chip ("Group: Acme Mobile Team ×"). */
export function FilterChip({ label, onRemove }: { label: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand-soft py-1 pr-1.5 pl-3 text-sm font-bold text-accent-text">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full hover:bg-accent/15"
      >
        ×
      </button>
    </span>
  );
}
