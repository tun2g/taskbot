import { type ReactNode, useCallback, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

import { POPOVER_PANEL, useDismiss } from './popover';

export interface MenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  onSelect: () => void;
}

/** A small dropdown. Used for row actions beyond the first few ("⋯") and the user menu. */
export function Menu({
  trigger,
  items,
  label,
  align = 'right',
  header,
  triggerClassName,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  label: string;
  align?: 'left' | 'right';
  header?: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close);

  return (
    <div ref={root} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex cursor-pointer items-center justify-center text-text-2 hover:bg-surface-2 hover:text-text',
          triggerClassName ?? 'size-8 rounded-lg',
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            POPOVER_PANEL,
            'min-w-52',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {header}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-[15px] hover:bg-surface-2',
                item.danger ? 'text-danger' : 'text-text',
              )}
            >
              {item.label}
              {item.hint && <span className="mt-0.5 block text-[13px] text-text-3">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MoreIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-4">
      <circle cx="4.5" cy="10" r="1.6" fill="currentColor" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" />
      <circle cx="15.5" cy="10" r="1.6" fill="currentColor" />
    </svg>
  );
}
