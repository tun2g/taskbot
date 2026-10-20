import { createRootRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { DisplaySettings } from '@/components/layout/display-settings';
import { ToastProvider } from '@/components/ui/toast';
import { getStoredToken } from '@/lib/auth';
import { getTelegramWebApp, isInTelegram, onRouteResolved, supportsTelegram } from '@/lib/telegram';

function applyTheme() {
  const webApp = getTelegramWebApp();
  const scheme = isInTelegram()
    ? webApp?.colorScheme
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  document.documentElement.dataset.theme = scheme === 'dark' ? 'dark' : 'light';
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Match Telegram's chrome to our header / page colors. Header: the theme's header_bg_color
 * (what our header paints) as a hex — any color is allowed from Bot API 6.9 — else bg_color.
 * Bottom bar (7.10+, also Android's nav bar): bg_color. Re-run on themeChanged.
 */
function applyChromeColors() {
  const webApp = getTelegramWebApp();
  if (!webApp || !isInTelegram()) return;
  try {
    if (supportsTelegram('6.1')) {
      const header = webApp.themeParams?.header_bg_color;
      webApp.setHeaderColor?.(header && HEX.test(header) && supportsTelegram('6.9') ? header : 'bg_color');
      webApp.setBackgroundColor?.('bg_color');
    }
    if (supportsTelegram('7.10')) webApp.setBottomBarColor?.('bg_color');
  } catch {
    // unsupported client
  }
}

function onThemeChanged() {
  applyTheme();
  applyChromeColors();
}

/** Viewport / fullscreen setup happens in main.tsx (bootTelegramViewport) before React mounts. */
function RootComponent() {
  // Resolved (post-redirect) path: leaving a deep-linked task turns on fullscreen.
  const pathname = useRouterState({ select: (s) => s.resolvedLocation?.pathname });
  useEffect(() => {
    if (pathname && isInTelegram()) onRouteResolved(pathname);
  }, [pathname]);

  useEffect(() => {
    const webApp = getTelegramWebApp();
    applyTheme();
    if (webApp && isInTelegram()) {
      webApp.ready();
      applyChromeColors();
      webApp.onEvent?.('themeChanged', onThemeChanged);
      return () => {
        webApp.offEvent?.('themeChanged', onThemeChanged);
      };
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', applyTheme);
    return () => media?.removeEventListener?.('change', applyTheme);
  }, []);

  return (
    <ToastProvider>
      <Outlet />
      {isInTelegram() && <DisplaySettings />}
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
