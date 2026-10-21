import { type ReactNode, useEffect, useId, useRef } from 'react';

import { pushBackInterceptor } from '@/lib/back-button';

import { Button } from './button';
import { useFocusTrap } from './use-focus-trap';

const openDialogs: object[] = [];

interface DialogProps {
  onClose: () => void;
  title: ReactNode;
  /** Muted text under the title (also the dialog's accessible description). */
  description?: ReactNode;
  /** `alertdialog` for destructive confirmations. */
  role?: 'dialog' | 'alertdialog';
  size?: 'sm' | 'md';
  /** Hide the ✕ (e.g. confirmations that have their own Cancel). */
  hideClose?: boolean;
  /** Buttons row, stacked full-width on phones and right-aligned from 640px. */
  footer?: ReactNode;
  /**
   * False: Esc, backdrop tap and Telegram's BackButton don't close it (only the footer's own
   * buttons do) — for sheets holding something the user must not lose, e.g. a one-time secret.
   */
  dismissible?: boolean;
  children?: ReactNode;
}

/**
 * Modal: a bottom sheet on phones (grab handle, safe-area padding), a centered card from
 * 640px. Esc, backdrop tap and Telegram's BackButton close it. Focus moves into it (Tab stays inside) and
 * returns to the opener on close.
 */
export function Dialog({
  onClose,
  title,
  description,
  role = 'dialog',
  size = 'md',
  hideClose,
  footer,
  dismissible = true,
  children,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const panelRef = useRef<HTMLDivElement>(null);
  // Read during the first render — by the time effects run, an `autoFocus` child has already taken focus.
  const openerRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  useFocusTrap(panelRef);

  useEffect(() => {
    const opener = openerRef.current;
    // Stacked dialogs (e.g. "New epic" over "Create task"): Esc closes only the top one.
    const token = {};
    openDialogs.push(token);
    const dismiss = () => {
      if (dismissibleRef.current) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openDialogs[openDialogs.length - 1] === token) dismiss();
    };
    window.addEventListener('keydown', onKey);
    // Still intercepts when not dismissible, so BackButton can't navigate away underneath it.
    const popBack = pushBackInterceptor(dismiss);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      openDialogs.splice(openDialogs.lastIndexOf(token), 1);
      popBack();
      document.body.style.overflow = prevOverflow;
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role={role}
      aria-modal
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // Clear landscape side insets, and end above the on-screen keyboard (lib/telegram.ts).
      style={{ left: 'var(--app-safe-left)', right: 'var(--app-safe-right)', bottom: 'var(--app-kb)' }}
    >
      <div className="tbot-fade-in fixed inset-0 bg-black/40" onClick={dismissible ? onClose : undefined} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{ maxHeight: 'calc(var(--app-vh) * 0.92 - var(--app-safe-top))' }}
        className={`tbot-sheet-in pb-safe relative w-full overflow-y-auto rounded-t-2xl bg-tg-section px-5 pt-2 shadow-xl outline-none sm:rounded-xl sm:pt-4 ${
          size === 'sm' ? 'max-w-md' : 'max-w-lg'
        }`}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-tg-hint/40 sm:hidden" aria-hidden />
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0 pt-2">
            <h2 id={titleId} className="text-lg font-semibold leading-snug text-tg-text">
              {title}
            </h2>
            {description && (
              <div id={descId} className="mt-1.5 text-sm text-tg-hint">
                {description}
              </div>
            )}
          </div>
          {!hideClose && dismissible && (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-2 text-tg-hint">
              ✕
            </Button>
          )}
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}
