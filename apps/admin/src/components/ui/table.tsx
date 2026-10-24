import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Tables scroll sideways inside their card on narrow screens; the page never does. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-y border-border bg-surface-2/60">{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = 'left',
  hint,
  className,
  sort,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  /** Short explanation shown under the column name. */
  hint?: string;
  className?: string;
  /** Makes the column name a "sort by this" button (highest / newest first). */
  sort?: { active: boolean; onSort: () => void };
}) {
  return (
    <th
      scope="col"
      aria-sort={sort?.active ? 'descending' : undefined}
      className={cn(
        'px-3 py-2 text-xs font-medium whitespace-nowrap text-text-2 first:pl-4 last:pr-4',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {sort ? (
        <button
          type="button"
          onClick={sort.onSort}
          title={sort.active ? 'Sorted by this column (highest first)' : 'Sort by this column (highest first)'}
          className={cn('inline-flex cursor-pointer items-center gap-1 hover:text-text', sort.active && 'text-text')}
        >
          {children}
          <span aria-hidden className={cn('text-[10px]', sort.active ? 'text-accent-text' : 'text-text-3/60')}>
            ▼
          </span>
        </button>
      ) : (
        children
      )}
      {hint && <span className="block text-[11px] font-normal text-text-3">{hint}</span>}
    </th>
  );
}

/** A row; when `onOpen` is set the whole row opens the detail page (Enter works too). */
export function Tr({ children, onOpen, className }: { children: ReactNode; onOpen?: () => void; className?: string }) {
  return (
    <tr
      onClick={onOpen}
      onKeyDown={onOpen ? (e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen() : undefined}
      tabIndex={onOpen ? 0 : undefined}
      className={cn(
        'border-b border-border last:border-b-0',
        onOpen && 'cursor-pointer hover:bg-surface-2/70 focus-visible:bg-surface-2',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  stop,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /** Don't let clicks here open the row (links / buttons inside). */
  stop?: boolean;
}) {
  return (
    <td
      onClick={stop ? (e) => e.stopPropagation() : undefined}
      className={cn(
        'px-3 py-2.5 align-middle first:pl-4 last:pr-4',
        align === 'right' ? 'text-right tabular' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function TotalRow({ children }: { children: ReactNode }) {
  return <tr className="border-t-2 border-border-strong bg-surface-2/50 font-medium">{children}</tr>;
}
