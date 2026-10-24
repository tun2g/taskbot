import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import { dismissToast, type ToastTone, useToasts } from '@/lib/toast';

const TONE: Record<ToastTone, { bar: string; icon: string }> = {
  success: { bar: 'bg-good', icon: '✓' },
  error: { bar: 'bg-danger', icon: '!' },
  warning: { bar: 'bg-warn', icon: '!' },
  info: { bar: 'bg-accent', icon: 'i' },
};

export function Toaster() {
  const toasts = useToasts();
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-0 bottom-0 left-0 z-[60] flex flex-col items-center gap-2 p-4 sm:left-auto sm:items-end"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className="toast-in pointer-events-auto flex w-full max-w-sm overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow-lg)]"
        >
          <span className={cn('w-1 shrink-0', TONE[t.tone].bar)} />
          <div className="min-w-0 flex-1 px-3 py-2.5">
            <p className="text-sm font-medium text-text">{t.title}</p>
            {t.body && <p className="mt-0.5 text-[13px] leading-relaxed text-text-2">{t.body}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="cursor-pointer px-3 text-text-3 hover:text-text"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
