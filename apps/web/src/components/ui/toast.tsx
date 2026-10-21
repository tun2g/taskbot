import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { haptic } from '@/lib/telegram';

type ToastKind = 'success' | 'error' | 'info';

export interface ToastOptions {
  /** A button at the end of the toast ("Undo"). Clicking it runs `onClick` and dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /** ms before it hides; defaults to 3s (5s for errors, 6s with an action). */
  duration?: number;
  /** A new toast with the same key replaces the old one (e.g. repeated moves of one card). */
  key?: string;
}

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastOptions['action'];
  key?: string;
  duration: number;
}

interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Hover/focus pauses the timer; leaving restarts it with at least this much time. */
const RESUME_MS = 2500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const schedule = useCallback(
    (id: number, ms: number) => {
      window.clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), ms),
      );
    },
    [dismiss],
  );

  const pause = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const duration = options.duration ?? (options.action ? 6000 : kind === 'error' ? 5000 : 3000);
      const toast: Toast = { id, kind, message, action: options.action, key: options.key, duration };
      setToasts((list) => {
        const replaced = options.key ? list.filter((t) => t.key === options.key) : [];
        replaced.forEach((t) => pause(t.id));
        const rest = list.filter((t) => !replaced.includes(t));
        return [...rest.slice(-2), toast];
      });
      if (kind !== 'info') haptic(kind);
      schedule(id, duration);
    },
    [pause, schedule],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      info: (m, o) => push('info', m, o),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(6rem + var(--app-safe-bottom))' }}
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => {
          const resume = () => schedule(t.id, t.action ? 4000 : RESUME_MS);
          return (
            <div
              key={t.id}
              onPointerEnter={() => pause(t.id)}
              onPointerLeave={resume}
              onFocus={() => pause(t.id)}
              onBlur={resume}
              className={`pointer-events-auto flex min-h-11 w-full max-w-sm items-stretch rounded-xl text-sm font-medium shadow-lg ${
                t.kind === 'error' ? 'bg-tg-destructive text-white' : 'bg-tg-text text-tg-bg'
              }`}
            >
              {t.action ? (
                // With an action, a stray tap on the text must not throw away the only way to it.
                <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2.5 pl-4 pr-2">
                  <ToastText kind={t.kind} message={t.message} />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label={`${t.message}. Dismiss`}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl py-2.5 pl-4 pr-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current"
                >
                  <ToastText kind={t.kind} message={t.message} />
                </button>
              )}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(t.id);
                    t.action?.onClick();
                  }}
                  className={`my-0.5 mr-0.5 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[10px] px-3 font-semibold uppercase tracking-wide outline-none transition-colors hover:bg-current/15 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current ${
                    t.kind === 'error' ? 'text-white' : 'text-[color-mix(in_srgb,var(--tg-theme-link-color)_55%,var(--tg-theme-bg-color))]'
                  }`}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

function ToastText({ kind, message }: { kind: string; message: ReactNode }) {
  return (
    <>
      <span aria-hidden>{kind === 'error' ? '⚠️' : kind === 'success' ? '✓' : 'ℹ️'}</span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{message}</span>
    </>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
