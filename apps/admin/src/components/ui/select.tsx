import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

import { POPOVER_PANEL, useDismiss } from './popover';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A second line under the label, explaining the option. */
  hint?: string;
}

/**
 * A dropdown picker (replaces the native <select>). `label` is shown inside the trigger ("Sort by · Last seen")
 * and names the control for screen readers. Keyboard: ↑/↓/Home/End move, Enter/Space pick, Esc closes.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  showLabel = true,
  align = 'left',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  label: string;
  /** Show `label` inside the trigger; turn off when a visible label sits next to it. */
  showLabel?: boolean;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  const openList = () => {
    setActive(selectedIndex);
    setOpen(true);
  };

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const pick = (index: number) => {
    const option = options[index];
    setOpen(false);
    trigger.current?.focus();
    if (option && option.value !== value) onChange(option.value);
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    }
  };

  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, active + 1),
      ArrowUp: Math.max(0, active - 1),
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key === 'Escape') {
      trigger.current?.focus();
    }
  };

  return (
    <div ref={root} className={cn('relative inline-block max-w-full', className)} onClick={(e) => e.stopPropagation()}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? ''}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onTriggerKey}
        className={cn(
          'inline-flex h-10 w-full max-w-full cursor-pointer items-center gap-2 rounded-xl border bg-surface pr-2.5 pl-3.5 text-left text-[15px] transition-colors',
          open ? 'border-accent ring-[3px] ring-accent/20' : 'border-border-strong hover:border-text-3/60 hover:bg-surface-2/60',
        )}
      >
        {showLabel && <span className="shrink-0 text-text-3">{label}</span>}
        <span className="min-w-0 flex-1 truncate font-medium text-text">{selected?.label}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <ul
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
          className={cn(POPOVER_PANEL, 'max-h-80 min-w-full overflow-y-auto outline-none', align === 'right' ? 'right-0' : 'left-0')}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg py-2 pr-3 pl-2.5 whitespace-nowrap',
                  i === active && 'bg-surface-2',
                )}
              >
                <CheckMark visible={isSelected} />
                <span className="min-w-0">
                  <span className={cn('block text-[15px]', isSelected ? 'font-semibold text-accent-text' : 'text-text')}>
                    {o.label}
                  </span>
                  {o.hint && <span className="mt-0.5 block text-[13px] whitespace-normal text-text-3">{o.hint}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cn('size-4 shrink-0 text-text-3 transition-transform', open && 'rotate-180')}>
      <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckMark({ visible }: { visible: boolean }): ReactNode {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cn('mt-0.5 size-4 shrink-0 text-accent-text', !visible && 'invisible')}>
      <path d="M4.5 10.5 8 14l7.5-8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
