import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';

/**
 * Explains the thing under the pointer (replaces the browser's `title` tooltip). Shows on hover and on keyboard
 * focus, renders in a portal so tables and cards never clip it, and flips below when there's no room above.
 * Keep the content short; anything the owner needs to act on belongs on the page, not in a tooltip.
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const below = a.top - b.height - 8 < 8;
    const left = Math.min(Math.max(8, a.left + a.width / 2 - b.width / 2), window.innerWidth - b.width - 8);
    setPos({ top: below ? a.bottom + 8 : a.top - b.height - 8, left, below });
  }, [open]);

  if (content == null || content === '') return <>{children}</>;
  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPos(null);
  };

  return (
    <span
      ref={anchor}
      className={cn('inline-flex max-w-full', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
            className="pointer-events-none fixed z-[60] max-w-72 rounded-lg bg-text px-2.5 py-1.5 text-[13px] leading-snug font-normal whitespace-normal text-surface shadow-[var(--shadow-lg)]"
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
