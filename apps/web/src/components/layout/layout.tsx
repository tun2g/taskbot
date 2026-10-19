import { type ReactNode, useEffect, useRef } from 'react';

import { getTelegramWebApp, isInTelegram } from '@/lib/telegram';

interface LayoutProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  fab?: ReactNode;
  /** Max content width; boards use the full width. */
  width?: 'narrow' | 'medium' | 'wide';
}

/** Shows Telegram's native BackButton while `onBack` is set (Mini App only). */
function useTelegramBackButton(onBack?: () => void) {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;
  const enabled = !!onBack;

  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp || !isInTelegram()) return;
    if (!enabled) {
      webApp.BackButton.hide();
      return;
    }
    const handler = () => handlerRef.current?.();
    webApp.BackButton.onClick(handler);
    webApp.BackButton.show();
    return () => {
      webApp.BackButton.offClick(handler);
      webApp.BackButton.hide();
    };
  }, [enabled]);
}

export function Layout({ title, subtitle, children, onBack, actions, fab, width = 'narrow' }: LayoutProps) {
  useTelegramBackButton(onBack);
  const showHeaderBack = !!onBack && !isInTelegram();
  const maxW = width === 'wide' ? 'max-w-7xl' : width === 'medium' ? 'max-w-5xl' : 'max-w-3xl';

  return (
    <div className="flex min-h-screen flex-col bg-tg-bg">
      <header className="sticky top-0 z-30 border-b border-tg-separator bg-tg-header">
        <div className={`mx-auto flex min-h-14 w-full items-center gap-1 px-2 ${maxW}`}>
          {showHeaderBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-tg-link active:bg-tg-secondary"
            >
              ←
            </button>
          ) : (
            <span className="w-2" />
          )}
          <div className="min-w-0 flex-1 py-2">
            {title && <h1 className="truncate text-lg font-semibold text-tg-text">{title}</h1>}
            {subtitle && <p className="truncate text-xs text-tg-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      </header>

      <main className={`mx-auto w-full flex-1 ${maxW}`} style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>
        {children}
      </main>

      {fab && <div className="fab-safe fixed z-40">{fab}</div>}
    </div>
  );
}
