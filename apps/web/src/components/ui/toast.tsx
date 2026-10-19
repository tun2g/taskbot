import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { haptic } from '@/lib/telegram';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-2), { id, kind, message }]);
      if (kind !== 'info') haptic(kind);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 5000 : 3000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom))' }}
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto flex min-h-11 w-full max-w-sm items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm font-medium shadow-lg ${
              t.kind === 'error' ? 'bg-tg-destructive text-white' : 'bg-tg-text text-tg-bg'
            }`}
          >
            <span aria-hidden>{t.kind === 'error' ? '⚠️' : t.kind === 'success' ? '✓' : 'ℹ️'}</span>
            <span className="flex-1">{t.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
