import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

import { pushBackInterceptor } from '@/lib/back-button';
import { getAppSafeTop, haptic } from '@/lib/telegram';

/* ------------------------------------------------------------------ types */

export interface SelectOption<T extends string = string> {
  value: T;
  /** Plain text: shown, searched, used for typeahead and the accessible name. */
  label: string;
  /** Emoji or small element (avatar) shown before the label. */
  icon?: ReactNode;
  /** Muted one-line second row. */
  hint?: string;
  /** Replaces icon + label in rows and the field trigger (e.g. a status lozenge). */
  content?: ReactNode;
}

export interface SelectSection<T extends string = string> {
  /** Small uppercase header; omit for an unlabelled section. */
  label?: string;
  options: SelectOption<T>[];
}

export interface SelectMenuProps<T extends string> {
  value: T | null | undefined;
  /** `null` when the clear option ("All types", "Unassigned", …) is picked. */
  onChange: (value: T | null) => void;
  /** Flat options, or `sections` for grouped ones. */
  options?: SelectOption<T>[];
  sections?: SelectSection<T>[];
  /** Accessible name of the list; also the bottom-sheet title. */
  title: string;
  /** A first row that maps to `null` ("All types", "Any priority", "Unassigned"). */
  clearOption?: { label: string; icon?: ReactNode; hint?: string };
  /** Search box; defaults to on when there are more than 8 options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  /** id for the trigger button (so an external <label htmlFor> works). */
  id?: string;

  /**
   * chip   — compact filter chip: "Type ▾", or "🐞 Bug ✕" when set (✕ clears).
   * field  — full-width field showing the current value.
   * custom — your own trigger content (`children`), e.g. a ⋯ button.
   */
  variant?: 'chip' | 'field' | 'custom';
  /** chip: text when nothing is selected; field: text when empty. */
  placeholder?: string;
  /** field: `ghost` (detail panel) or `input` (form field look). */
  appearance?: 'ghost' | 'input';
  /** custom: trigger content. */
  children?: ReactNode;
  /** Overrides the trigger's accessible name. */
  triggerLabel?: string;
  triggerClassName?: string;
  /** Popover alignment against the trigger (desktop). */
  align?: 'start' | 'end';
  /** Popover min width in px (desktop). Default 240. */
  menuWidth?: number;
}

/* ------------------------------------------------------------------ helpers */

const MOBILE_QUERY = '(max-width: 639px)';

function subscribeMobile(cb: () => void) {
  const media = window.matchMedia?.(MOBILE_QUERY);
  media?.addEventListener?.('change', cb);
  return () => media?.removeEventListener?.('change', cb);
}

function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeMobile,
    () => !!window.matchMedia?.(MOBILE_QUERY).matches,
    () => false,
  );
}

const stop = (e: SyntheticEvent) => e.stopPropagation();

interface Item<T extends string> {
  value: T | null;
  option: SelectOption<T>;
}

interface Section<T extends string> {
  label?: string;
  items: { item: Item<T>; index: number }[];
}

interface PopoverPos {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

/* ------------------------------------------------------------------ component */

/**
 * Telegram-style select: a popover on desktop, a bottom sheet on phones. Never opens the
 * OS-native menu. Listbox semantics with aria-activedescendant, arrow keys, Home/End,
 * Enter, Escape and first-letter typeahead.
 */
export function SelectMenu<T extends string>(props: SelectMenuProps<T>) {
  const {
    value,
    onChange,
    options,
    sections,
    title,
    clearOption,
    searchPlaceholder = 'Search…',
    disabled,
    id,
    variant = 'field',
    placeholder,
    appearance = 'ghost',
    children,
    triggerLabel,
    triggerClassName = '',
    align = 'start',
    menuWidth = 240,
  } = props;

  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const [dragY, setDragY] = useState(0);

  const baseId = useId();
  const listId = `${baseId}-list`;
  const optId = (i: number) => `${baseId}-opt-${i}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ buffer: '', at: 0 });
  const dragStart = useRef<number | null>(null);

  const allSections: SelectSection<T>[] = useMemo(() => sections ?? [{ options: options ?? [] }], [sections, options]);
  const optionCount = allSections.reduce((n, s) => n + s.options.length, 0);
  const searchable = props.searchable ?? optionCount > 8;

  const isSelected = (v: T | null) => (v === null ? value == null || value === '' : v === value);
  const currentOption = useMemo(
    () => allSections.flatMap((s) => s.options).find((o) => o.value === value),
    [allSections, value],
  );

  // Visible rows (after search), flattened for keyboard navigation.
  const { flat, visibleSections } = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const matches = (o: SelectOption<T>) =>
      !q || o.label.toLocaleLowerCase().includes(q) || (o.hint?.toLocaleLowerCase().includes(q) ?? false);
    const flatItems: Item<T>[] = [];
    const out: Section<T>[] = [];
    if (clearOption && !q) {
      flatItems.push({ value: null, option: { value: '' as T, ...clearOption } });
      out.push({ items: [{ item: flatItems[0], index: 0 }] });
    }
    for (const s of allSections) {
      const items = s.options.filter(matches).map((o) => {
        const item = { value: o.value, option: o };
        flatItems.push(item);
        return { item, index: flatItems.length - 1 };
      });
      if (items.length) out.push({ label: s.label, items });
    }
    return { flat: flatItems, visibleSections: out };
  }, [allSections, clearOption, query]);

  /* ---------- open / close ---------- */

  const openMenu = useCallback(() => {
    if (disabled) return;
    setQuery('');
    setPos(null);
    setDragY(0);
    setOpen(true);
  }, [disabled]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setQuery('');
    setDragY(0);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const choose = (item: Item<T> | undefined) => {
    if (!item) return;
    close();
    if (!isSelected(item.value)) {
      haptic('light');
      onChange(item.value);
    }
  };

  // Start on the selected row.
  useEffect(() => {
    if (!open) return;
    const i = flat.findIndex((it) => isSelected(it.value));
    setActive(i >= 0 ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the active row in range while searching.
  useEffect(() => {
    if (open && query) setActive(0);
  }, [query, open]);

  // Focus the search box (desktop) or the listbox.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      if (searchable && !isMobile) searchRef.current?.focus({ preventScroll: true });
      else listRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, searchable, isMobile]);

  // Scroll the active row into view.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  // Outside click closes (the popover itself stops pointerdown from bubbling).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  // Telegram BackButton closes the menu first.
  useEffect(() => {
    if (!open) return;
    return pushBackInterceptor(() => close());
  }, [open, close]);

  // Bottom sheet: lock page scroll.
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  /* ---------- desktop positioning: below, or flipped up; always inside the viewport ---------- */

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const pop = popRef.current;
    const list = listRef.current;
    if (!trigger || !pop || !list) return;
    const r = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 4;
    const width = Math.min(Math.max(r.width, menuWidth), 360, vw - margin * 2);
    const natural = Math.min(pop.offsetHeight - list.clientHeight + list.scrollHeight, 420);
    // Never under Telegram's fullscreen buttons.
    const safeTop = getAppSafeTop();
    const below = vh - r.bottom - gap - margin;
    const above = r.top - gap - margin - safeTop;
    const down = natural <= below || below >= above;
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.max(margin, Math.min(left, vw - width - margin));
    setPos(
      down
        ? { left, width, maxHeight: Math.max(120, Math.min(below, 420)), top: Math.max(safeTop + margin, r.bottom + gap) }
        : { left, width, maxHeight: Math.max(120, Math.min(above, 420)), bottom: vh - r.top + gap },
    );
  }, [align, menuWidth]);

  useLayoutEffect(() => {
    if (!open || isMobile) return;
    place();
  }, [open, isMobile, place, flat.length]);

  useEffect(() => {
    if (!open || isMobile) return;
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, isMobile, place]);

  /* ---------- keyboard ---------- */

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation(); // keep Escape / "/" / Enter away from modals, cards and shortcuts
    const inSearch = e.target === searchRef.current;
    const last = flat.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => (i >= last ? 0 : i + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => (i <= 0 ? last : i - 1));
        return;
      case 'Home':
        if (inSearch) return;
        e.preventDefault();
        setActive(0);
        return;
      case 'End':
        if (inSearch) return;
        e.preventDefault();
        setActive(last);
        return;
      case 'Enter':
        e.preventDefault();
        choose(flat[active]);
        return;
      case ' ':
        if (inSearch) return;
        e.preventDefault();
        choose(flat[active]);
        return;
      case 'Escape':
        e.preventDefault();
        close();
        return;
      case 'Tab':
        e.preventDefault();
        close();
        return;
    }
    if (inSearch || e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    // Typeahead by first letter(s).
    const now = Date.now();
    const ta = typeahead.current;
    ta.buffer = now - ta.at > 600 ? e.key.toLocaleLowerCase() : ta.buffer + e.key.toLocaleLowerCase();
    ta.at = now;
    const start = ta.buffer.length === 1 ? active + 1 : active;
    for (let k = 0; k < flat.length; k++) {
      const i = (start + k) % flat.length;
      if (flat[i].option.label.toLocaleLowerCase().startsWith(ta.buffer)) {
        setActive(i);
        break;
      }
    }
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openMenu();
    }
  };

  /* ---------- swipe down to close (sheet) ---------- */

  const onDragStart = (e: ReactTouchEvent) => {
    dragStart.current = e.touches[0].clientY;
  };
  const onDragMove = (e: ReactTouchEvent) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - dragStart.current));
  };
  const onDragEnd = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (dragY > 80) close();
    else setDragY(0);
  };

  /* ---------- rendering ---------- */

  const currentText =
    currentOption?.label ?? (value ? String(value) : (clearOption?.label ?? placeholder ?? 'Not set'));
  const ariaLabel = triggerLabel ?? `${title}: ${currentText}`;
  const hasValue = value != null && value !== '';

  const triggerProps = {
    ref: triggerRef,
    id,
    type: 'button' as const,
    disabled,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    'aria-label': ariaLabel,
    onClick: () => (open ? close() : openMenu()),
    onKeyDown: onTriggerKeyDown,
  };

  let trigger: ReactNode;
  if (variant === 'chip') {
    trigger = (
      <span
        className={`inline-flex min-h-11 shrink-0 items-center rounded-lg text-sm font-medium transition-colors sm:min-h-9 ${
          hasValue ? 'tint-link' : 'border border-tg-separator text-tg-text hover:bg-tg-secondary'
        } ${triggerClassName}`}
      >
        <button
          {...triggerProps}
          className={`focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg pl-3 sm:min-h-9 ${hasValue ? 'pr-1' : 'pr-2.5'}`}
        >
          {hasValue && currentOption?.icon && (
            <span aria-hidden className="shrink-0 leading-none">
              {currentOption.icon}
            </span>
          )}
          <span className="max-w-[160px] truncate">{hasValue ? currentText : placeholder}</span>
          {!hasValue && <Chevron />}
        </button>
        {hasValue && (
          <button
            type="button"
            aria-label={`Clear ${title.toLocaleLowerCase()} filter`}
            onClick={() => onChange(null)}
            className="focus-ring relative flex h-11 w-9 items-center justify-center rounded-md text-xs opacity-70 after:absolute after:inset-y-0 after:-right-2 after:left-0 after:content-[''] hover:opacity-100 sm:h-8 sm:after:-inset-y-1.5"
          >
            ✕
          </button>
        )}
      </span>
    );
  } else if (variant === 'field') {
    const look =
      appearance === 'input'
        ? 'w-full rounded-lg border border-tg-separator bg-tg-section px-3 hover:border-tg-hint/60'
        : '-mx-2 w-[calc(100%+1rem)] rounded-md px-2 hover:bg-tg-secondary';
    trigger = (
      <button
        {...triggerProps}
        className={`focus-ring flex min-h-11 items-center gap-2 text-left text-sm text-tg-text transition-colors disabled:opacity-60 ${look} ${
          open && appearance === 'input' ? 'border-tg-link' : ''
        } ${triggerClassName}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {currentOption ? (
            (currentOption.content ?? (
              <>
                {currentOption.icon && (
                  <span aria-hidden className="flex shrink-0 items-center leading-none">
                    {currentOption.icon}
                  </span>
                )}
                <span className="truncate">{currentOption.label}</span>
              </>
            ))
          ) : !hasValue && clearOption ? (
            <>
              {clearOption.icon && (
                <span aria-hidden className="flex shrink-0 items-center leading-none">
                  {clearOption.icon}
                </span>
              )}
              <span className="truncate text-tg-hint">{clearOption.label}</span>
            </>
          ) : (
            <span className="truncate text-tg-hint">{placeholder ?? 'Not set'}</span>
          )}
        </span>
        <Chevron className="text-tg-hint" />
      </button>
    );
  } else {
    trigger = (
      <button {...triggerProps} className={`focus-ring ${triggerClassName}`}>
        {children}
      </button>
    );
  }

  const searchBox = searchable && (
    <div className="px-1 pb-1 pt-0.5">
      <input
        ref={searchRef}
        type="text"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={flat.length ? optId(active) : undefined}
        aria-label={`Search ${title.toLocaleLowerCase()}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={searchPlaceholder}
        className="h-9 w-full rounded-lg bg-tg-secondary px-3 text-sm text-tg-text outline-none placeholder:text-tg-hint focus:ring-2 focus:ring-tg-link/50"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );

  const list = (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={title}
      tabIndex={-1}
      aria-activedescendant={flat.length ? optId(active) : undefined}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
    >
      {flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-tg-hint">No matches</p>}
      {visibleSections.map((section, si) => {
        const headerId = `${baseId}-sec-${si}`;
        return (
          <div
            key={si}
            role="group"
            aria-labelledby={section.label ? headerId : undefined}
            className={si > 0 ? 'mt-1 border-t border-tg-separator pt-1' : ''}
          >
            {section.label && (
              <p
                id={headerId}
                className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-tg-hint"
              >
                {section.label}
              </p>
            )}
            {section.items.map(({ item, index }) => (
              <OptionRow
                key={item.value ?? '__clear'}
                id={optId(index)}
                option={item.option}
                selected={isSelected(item.value)}
                active={index === active}
                onHover={() => setActive(index)}
                onSelect={() => choose(item)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );

  const stopProps = {
    onPointerDown: stop,
    onMouseDown: stop,
    onTouchStart: stop,
    onClick: stop,
    onKeyDown: onMenuKeyDown,
  };

  let menu: ReactNode = null;
  if (open && isMobile) {
    menu = (
      <div
        className="fixed inset-0 z-[55]"
        style={{ left: 'var(--app-safe-left)', right: 'var(--app-safe-right)', bottom: 'var(--app-kb)' }}
        {...stopProps}
      >
        <div className="tbot-fade-in absolute inset-0 bg-black/40" onClick={() => close()} aria-hidden />
        <div
          ref={popRef}
          role="dialog"
          aria-modal
          aria-label={title}
          className="tbot-sheet-in absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl bg-tg-bg px-2 shadow-2xl"
          style={{
            maxHeight: 'calc(var(--app-vh) * 0.8 - var(--app-safe-top))',
            paddingBottom: 'max(0.5rem, var(--app-safe-bottom))',
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: dragY && dragStart.current !== null ? 'none' : undefined,
          }}
        >
          <div
            className="shrink-0 touch-none pb-2 pt-2"
            onTouchStart={(e) => {
              stop(e);
              onDragStart(e);
            }}
            onTouchMove={onDragMove}
            onTouchEnd={onDragEnd}
            onTouchCancel={onDragEnd}
          >
            <div className="mx-auto h-1 w-9 rounded-full bg-tg-hint/40" aria-hidden />
            <div className="mt-2 flex items-center px-2">
              <h2 className="flex-1 truncate text-base font-semibold text-tg-text">{title}</h2>
              <button
                type="button"
                onClick={() => close()}
                className="focus-ring -mr-1 min-h-11 rounded-lg px-2 text-sm font-medium text-tg-link"
              >
                Done
              </button>
            </div>
          </div>
          {searchBox}
          {list}
        </div>
      </div>
    );
  } else if (open) {
    const style: CSSProperties = pos
      ? { left: pos.left, width: pos.width, maxHeight: pos.maxHeight, top: pos.top, bottom: pos.bottom }
      : { left: 0, top: 0, width: menuWidth, visibility: 'hidden' };
    menu = (
      <div
        ref={popRef}
        className={`tbot-pop-in fixed z-[55] flex max-h-[420px] flex-col rounded-xl border border-tg-separator bg-tg-section p-1 shadow-[0_8px_28px_-6px_rgba(0,0,0,0.25),0_2px_6px_rgba(0,0,0,0.08)] ${
          pos?.bottom !== undefined ? 'origin-bottom' : 'origin-top'
        }`}
        style={style}
        {...stopProps}
      >
        {searchBox}
        {list}
      </div>
    );
  }

  return (
    <>
      {trigger}
      {menu && createPortal(menu, document.body)}
    </>
  );
}

function OptionRow<T extends string>({
  id,
  option,
  selected,
  active,
  onHover,
  onSelect,
}: {
  id: string;
  option: SelectOption<T>;
  selected: boolean;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onPointerMove={onHover}
      onClick={onSelect}
      className={`flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-1.5 transition-colors duration-100 sm:min-h-10 ${
        active ? 'tint-hover' : ''
      }`}
    >
      {option.content ? (
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          {option.content}
          {option.hint && <span className="w-full truncate text-xs text-tg-hint">{option.hint}</span>}
        </span>
      ) : (
        <>
          {option.icon !== undefined && (
            <span aria-hidden className="flex w-6 shrink-0 items-center justify-center text-base leading-none">
              {option.icon}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={`truncate text-sm text-tg-text ${selected ? 'font-medium' : ''}`}>{option.label}</span>
            {option.hint && <span className="truncate text-xs leading-4 text-tg-hint">{option.hint}</span>}
          </span>
        </>
      )}
      <span aria-hidden className="flex w-4 shrink-0 justify-end text-sm font-semibold text-tg-link">
        {selected ? '✓' : ''}
      </span>
    </div>
  );
}

function Chevron({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 opacity-70 ${className}`} fill="none">
      <path
        d="M3 4.5 6 7.5 9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
