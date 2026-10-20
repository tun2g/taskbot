import { type ReactNode, useEffect, useRef } from 'react';

import { setPageBack } from '@/lib/back-button';
import { isInTelegram } from '@/lib/telegram';

interface LayoutProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  fab?: ReactNode;
  /** Max content width; boards use the full width. */
  width?: 'narrow' | 'medium' | 'wide';
  /**
   * Show Telegram's native BackButton for `onBack` (default). False on a deep-linked "quick
   * look" task so Telegram shows "Close" instead; the in-page breadcrumb still goes back.
   */
  nativeBack?: boolean;
}

/** Shows Telegram's native BackButton while `onBack` is set (Mini App only). */
function useTelegramBackButton(onBack?: () => void, nativeBack = true) {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;
  const enabled = !!onBack && nativeBack;

  useEffect(() => {
    if (!enabled || !isInTelegram()) return;
    return setPageBack(() => handlerRef.current?.());
  }, [enabled]);
}

export function Layout({ title, subtitle, children, onBack, actions, fab, width = 'narrow', nativeBack }: LayoutProps) {
  useTelegramBackButton(onBack, nativeBack);
  const showHeaderBack = !!onBack && !isInTelegram();
  const maxW = width === 'wide' ? 'max-w-7xl' : width === 'medium' ? 'max-w-5xl' : 'max-w-3xl';

  return (
    <div className="flex min-h-screen flex-col bg-tg-bg">
      {/* .app-header*: see app.css — in Telegram fullscreen the title sits inside the pill band. */}
      <header className="app-header sticky top-0 z-30 border-b border-tg-separator bg-tg-header">
        <div className={`app-header-row mx-auto w-full px-2 ${maxW}`}>
          {showHeaderBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="app-header-lead flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-tg-link active:bg-tg-secondary"
            >
              ←
            </button>
          ) : (
            <span className="app-header-lead w-2" />
          )}
          <div className="app-header-title min-w-0 py-2">
            {title && <h1 className="max-w-full truncate text-lg font-semibold text-tg-text">{title}</h1>}
            {subtitle && <p className="max-w-full truncate text-xs text-tg-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="app-header-actions flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      </header>

      <main
        className={`px-app-safe mx-auto w-full flex-1 ${maxW}`}
        style={{ paddingBottom: 'calc(6rem + var(--app-safe-bottom))' }}
      >
        {children}
      </main>

      {fab && <div className="fab-safe fixed z-40">{fab}</div>}
    </div>
  );
}
