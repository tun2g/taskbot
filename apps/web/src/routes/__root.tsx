import { createRootRoute, Outlet, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';

import { ToastProvider } from '@/components/ui/toast';
import { getStoredToken } from '@/lib/auth';
import { getTelegramWebApp, isInTelegram } from '@/lib/telegram';

function applyTheme() {
  const webApp = getTelegramWebApp();
  const scheme = isInTelegram()
    ? webApp?.colorScheme
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  document.documentElement.dataset.theme = scheme === 'dark' ? 'dark' : 'light';
}

function RootComponent() {
  useEffect(() => {
    const webApp = getTelegramWebApp();
    applyTheme();
    if (webApp && isInTelegram()) {
      webApp.ready();
      webApp.expand();
      // Match Telegram's chrome to our header / page colors (Bot API 6.1+).
      try {
        if (webApp.isVersionAtLeast?.('6.1') ?? true) {
          webApp.setHeaderColor?.('bg_color');
          webApp.setBackgroundColor?.('bg_color');
        }
      } catch {
        // unsupported client
      }
      webApp.onEvent?.('themeChanged', applyTheme);
      return () => webApp.offEvent?.('themeChanged', applyTheme);
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', applyTheme);
    return () => media?.removeEventListener?.('change', applyTheme);
  }, []);

  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    // Inside Telegram, initData authenticates every request. In a browser we need a token.
    if (location.pathname.startsWith('/login') || isInTelegram() || getStoredToken()) return;
    throw redirect({ to: '/login', search: { redirect: location.href }, replace: true });
  },
  component: RootComponent,
});
