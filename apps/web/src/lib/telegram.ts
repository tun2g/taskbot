type TelegramEvent = 'themeChanged' | 'viewportChanged' | 'backButtonClicked';

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    start_param?: string;
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
  };
  version?: string;
  platform?: string;
  ready: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  isVersionAtLeast?: (version: string) => boolean;
  expand: () => void;
  close: () => void;
  onEvent?: (event: TelegramEvent, cb: () => void) => void;
  offEvent?: (event: TelegramEvent, cb: () => void) => void;
  MainButton: {
    text: string;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    enable: () => void;
    disable: () => void;
    showProgress: () => void;
    hideProgress: () => void;
  };
  BackButton: {
    isVisible?: boolean;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  };
  themeParams: Record<string, string>;
  colorScheme: 'light' | 'dark';
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp | undefined {
  return typeof window === 'undefined' ? undefined : window.Telegram?.WebApp;
}

/**
 * True only when actually running as a Mini App. telegram-web-app.js is always loaded
 * (index.html), so `window.Telegram.WebApp` also exists in a normal browser — but there
 * `initData` is empty.
 */
export function isInTelegram(): boolean {
  return !!getTelegramWebApp()?.initData;
}

export function getInitData(): string | undefined {
  return getTelegramWebApp()?.initData || undefined;
}

export function getStartParam(): string | undefined {
  return getTelegramWebApp()?.initDataUnsafe?.start_param || undefined;
}

let startParamConsumed = false;

/**
 * Parses `startapp=<groupId>[_<taskId>]` once per app load. Returns null after the first
 * call so navigating back to `/` shows the groups list instead of re-redirecting.
 */
export function consumeStartParam(): { groupId: string; taskId?: string } | null {
  if (startParamConsumed) return null;
  startParamConsumed = true;
  const raw = getStartParam();
  if (!raw) return null;
  const [groupId, taskId] = raw.split('_');
  if (!groupId) return null;
  return { groupId, taskId: taskId || undefined };
}

export function haptic(type: 'success' | 'error' | 'light') {
  const fb = getTelegramWebApp()?.HapticFeedback;
  if (!fb || !isInTelegram()) return;
  try {
    if (type === 'light') fb.impactOccurred('light');
    else fb.notificationOccurred(type);
  } catch {
    // older clients
  }
}
