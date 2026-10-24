import { type RefObject, useEffect } from 'react';

/** The floating panel look shared by dropdowns (Select, Menu). */
export const POPOVER_PANEL =
  'absolute z-40 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-lg)]';

/** Closes a popover on a click outside `root` or on Escape. */
export function useDismiss(root: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [root, open, close]);
}
