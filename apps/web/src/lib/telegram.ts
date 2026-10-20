type TelegramEvent =
  | 'themeChanged'
  | 'viewportChanged'
  | 'backButtonClicked'
  // Bot API 8.0+
  | 'fullscreenChanged'
  | 'fullscreenFailed'
  | 'safeAreaChanged'
  | 'contentSafeAreaChanged'
  // Bot API 6.1+ (SettingsButton itself is 7.0+)
  | 'settingsButtonClicked';

export interface TelegramSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

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
  /** Bot API 7.10+ — `#RRGGBB` or bg_color / secondary_bg_color / bottom_bar_bg_color. */
  setBottomBarColor?: (color: string) => void;
  isVersionAtLeast?: (version: string) => boolean;
  expand: () => void;
  isExpanded?: boolean;
  /** Bot API 8.0+ */
  requestFullscreen?: () => void;
  /** Bot API 8.0+ */
  exitFullscreen?: () => void;
  /** Bot API 8.0+ */
  isFullscreen?: boolean;
  /** Bot API 8.0+ — device insets (notch / home bar). Also CSS `--tg-safe-area-inset-*`. */
  safeAreaInset?: TelegramSafeAreaInset;
  /** Bot API 8.0+ — Telegram's own UI overlay. Also CSS `--tg-content-safe-area-inset-*`. */
  contentSafeAreaInset?: TelegramSafeAreaInset;
  /** Bot API 7.7+ */
  isVerticalSwipesEnabled?: boolean;
  /** Bot API 7.7+ — stop vertical swipes from collapsing / closing the Mini App. */
  disableVerticalSwipes?: () => void;
  /** Bot API 7.7+ */
  enableVerticalSwipes?: () => void;
  close: () => void;
  // Handlers get `this` = WebApp; `fullscreenFailed` receives `{ error: 'UNSUPPORTED' | 'ALREADY_FULLSCREEN' }`.
  onEvent?: (event: TelegramEvent, cb: (payload?: unknown) => void) => void;
  offEvent?: (event: TelegramEvent, cb: (payload?: unknown) => void) => void;
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
  /** Bot API 7.0+ — the "Settings" item in the Mini App's ⋯ menu. Its label can't be changed. */
  SettingsButton?: {
    isVisible?: boolean;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  /** Bot API 6.9+ — per-user key/value store synced through Telegram. */
  CloudStorage?: {
    getItem: (key: string, cb: (err: string | null, value?: string) => void) => void;
    setItem: (key: string, value: string, cb?: (err: string | null, ok?: boolean) => void) => void;
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

/**
 * Phone Telegram clients — the only ones where auto-fullscreen makes sense. Tablets (iPad,
 * Android tablets) report the same platform, so also require a phone-sized short screen side.
 */
export function isTelegramMobile(): boolean {
  const platform = getTelegramWebApp()?.platform;
  if (platform !== 'ios' && platform !== 'android' && platform !== 'android_x') return false;
  if (typeof screen === 'undefined') return true;
  return Math.min(screen.width, screen.height) < 600;
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
/** `/<groupId>/tasks/<taskId>` when the app was opened straight onto a task (deep link). */
let landedTaskPath: string | null = null;
/** Set once the user navigates away from the landed-on task. */
let leftLanding = false;

/** `startapp=<groupId>_<taskId>` — a "quick look" at one task from a chat message. */
export function isTaskDeepLink(): boolean {
  const [groupId, taskId] = (getStartParam() ?? '').split('_');
  return !!groupId && !!taskId;
}

/**
 * True while the user is still on the task the deep link opened. That page runs as a quick
 * look: no fullscreen, no native BackButton (Telegram shows "Close" instead).
 */
export function isLandedTask(groupId: string, taskId: string): boolean {
  return !leftLanding && landedTaskPath === `/${groupId}/tasks/${taskId}`;
}

/**
 * Call on every resolved route change. Leaving the landed task ends the quick look and
 * switches to the full app experience (fullscreen on phones).
 */
export function onRouteResolved(pathname: string) {
  if (!leftLanding && landedTaskPath && pathname !== landedTaskPath) leftLanding = true;
  if (leftLanding || !isTaskDeepLink()) ensureFullscreen();
}

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
  if (taskId) landedTaskPath = `/${groupId}/tasks/${taskId}`;
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

export function supportsTelegram(version: string): boolean {
  try {
    return getTelegramWebApp()?.isVersionAtLeast?.(version) ?? false;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------------------------
 * Vertical swipes (Bot API 7.7+). Left enabled by default so the app can be swiped down /
 * closed like any Mini App; lock them only during gestures that would otherwise collapse it
 * (e.g. dragging a kanban card).
 * ------------------------------------------------------------------------------------------- */

export function lockVerticalSwipes() {
  if (!isInTelegram() || !supportsTelegram('7.7')) return;
  try {
    getTelegramWebApp()?.disableVerticalSwipes?.();
  } catch {
    // unsupported client
  }
}

export function unlockVerticalSwipes() {
  if (!isInTelegram() || !supportsTelegram('7.7')) return;
  try {
    getTelegramWebApp()?.enableVerticalSwipes?.();
  } catch {
    // unsupported client
  }
}

/* ---------------------------------------------------------------------------------------------
 * Fullscreen (Bot API 8.0+, phones only) + the user's on/off preference.
 * ------------------------------------------------------------------------------------------- */

const FULLSCREEN_PREF_KEY = 'tbot_fullscreen';
let fullscreenPref: boolean | null = null;
let fullscreenRequested = false;

function readCachedPref(): boolean | null {
  try {
    const v = localStorage.getItem(FULLSCREEN_PREF_KEY);
    return v === null ? null : v !== '0';
  } catch {
    return null;
  }
}

function writeCachedPref(on: boolean) {
  try {
    localStorage.setItem(FULLSCREEN_PREF_KEY, on ? '1' : '0');
  } catch {
    // private mode / blocked storage
  }
}

/** Fullscreen is possible on this client at all (phone, Bot API 8.0+). */
export function canFullscreen(): boolean {
  return isInTelegram() && isTelegramMobile() && supportsTelegram('8.0');
}

/** Current preference (default on). */
export function getFullscreenPref(): boolean {
  return fullscreenPref ?? readCachedPref() ?? true;
}

/**
 * Resolves the preference. With a value cached on this device it answers immediately (and
 * refreshes the cache from CloudStorage in the background); on a first launch it waits for
 * CloudStorage up to `timeoutMs`, then falls back to the default.
 */
export function loadFullscreenPref(timeoutMs: number): Promise<boolean> {
  const cached = readCachedPref();
  const cloud = isInTelegram() && supportsTelegram('6.9') ? getTelegramWebApp()?.CloudStorage : undefined;
  return new Promise((resolve) => {
    let done = false;
    const finish = (on: boolean) => {
      if (done) return;
      done = true;
      fullscreenPref = on;
      resolve(on);
    };
    if (cached !== null) finish(cached);
    if (!cloud) {
      finish(cached ?? true);
      return;
    }
    const timer = setTimeout(() => finish(cached ?? true), timeoutMs);
    try {
      cloud.getItem(FULLSCREEN_PREF_KEY, (err, value) => {
        clearTimeout(timer);
        if (err || value === undefined || value === '') {
          finish(cached ?? true);
          return;
        }
        const on = value !== '0';
        writeCachedPref(on);
        if (!done) {
          finish(on);
        } else if (on !== fullscreenPref) {
          // Changed on another device since this one cached it — follow the cloud value.
          fullscreenPref = on;
          if (on) ensureFullscreen();
          else exitFullscreen();
        }
      });
    } catch {
      clearTimeout(timer);
      finish(cached ?? true);
    }
  });
}

/** Saves the preference (CloudStorage + local cache) and applies it right away. */
export function setFullscreenPref(on: boolean) {
  fullscreenPref = on;
  writeCachedPref(on);
  const cloud = isInTelegram() && supportsTelegram('6.9') ? getTelegramWebApp()?.CloudStorage : undefined;
  try {
    cloud?.setItem(FULLSCREEN_PREF_KEY, on ? '1' : '0');
  } catch {
    // best effort — the local cache still has it
  }
  if (on) {
    fullscreenRequested = false;
    ensureFullscreen();
  } else {
    exitFullscreen();
  }
}

function exitFullscreen() {
  const webApp = getTelegramWebApp();
  if (!webApp?.isFullscreen) return;
  try {
    webApp.exitFullscreen?.();
  } catch {
    // unsupported client
  }
}

/**
 * Requests fullscreen once per app load on phones, unless the user turned it off or the app
 * is still showing a deep-linked task as a quick look. Returns true if it was requested now.
 */
export function ensureFullscreen(): boolean {
  if (fullscreenRequested || !canFullscreen() || !getFullscreenPref()) return false;
  if (isTaskDeepLink() && !leftLanding) return false;
  const webApp = getTelegramWebApp();
  if (!webApp || webApp.isFullscreen) return false;
  fullscreenRequested = true;
  try {
    webApp.requestFullscreen?.();
    return true;
  } catch {
    return false;
  }
}

/** Mirrors WebApp.isFullscreen onto <html> so CSS can reserve room for Telegram's overlay. */
export function syncFullscreenAttr() {
  document.documentElement.dataset.tgFullscreen = getTelegramWebApp()?.isFullscreen ? 'true' : 'false';
}

/** px Telegram's fullscreen overlay takes at the top (device inset + its own buttons). */
export function getAppSafeTop(): number {
  const webApp = getTelegramWebApp();
  if (!webApp?.isFullscreen) return 0;
  return (webApp.safeAreaInset?.top ?? 0) + (webApp.contentSafeAreaInset?.top ?? 0);
}

/* ---------------------------------------------------------------------------------------------
 * Keyboard: the on-screen keyboard shrinks visualViewport, not always the layout viewport.
 * Exposes --app-vh (visible height), --app-kb (px the keyboard covers at the bottom) and
 * html[data-kb='true'] so sheets / composers stay above it.
 * ------------------------------------------------------------------------------------------- */

function syncVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const covered = window.innerHeight - vv.height;
  const kb = covered > 120;
  root.style.setProperty('--app-vh', `${Math.round(vv.height)}px`);
  root.style.setProperty('--app-kb', kb ? `${Math.max(0, Math.round(covered - vv.offsetTop))}px` : '0px');
  root.dataset.kb = kb ? 'true' : 'false';
}

/* ---------------------------------------------------------------------------------------------
 * Boot — runs in main.tsx before React mounts, so fullscreen starts as early as possible.
 * ------------------------------------------------------------------------------------------- */

const BOOT_TIMEOUT_MS = 300;

/**
 * Sets up viewport tracking and (on phones) requests fullscreen. Resolves once the layout is
 * settled — fullscreenChanged / fullscreenFailed, or after ~300ms — so the boot splash can
 * hide the jump. Resolves immediately when nothing was requested.
 */
export function bootTelegramViewport(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  if (window.visualViewport) {
    syncVisualViewport();
    window.visualViewport.addEventListener('resize', syncVisualViewport);
    window.visualViewport.addEventListener('scroll', syncVisualViewport);
  }

  const webApp = getTelegramWebApp();
  if (!webApp || !isInTelegram()) return Promise.resolve();

  syncFullscreenAttr();
  webApp.onEvent?.('fullscreenChanged', syncFullscreenAttr);
  webApp.onEvent?.('fullscreenFailed', syncFullscreenAttr);
  webApp.onEvent?.('safeAreaChanged', syncFullscreenAttr);
  webApp.onEvent?.('contentSafeAreaChanged', syncFullscreenAttr);
  webApp.onEvent?.('viewportChanged', syncVisualViewport);
  try {
    webApp.expand();
  } catch {
    // older clients
  }

  if (!canFullscreen() || webApp.isFullscreen) return Promise.resolve();
  if (isTaskDeepLink()) {
    // Quick look: stay in the normal sheet; know the preference for when the user moves on.
    void loadFullscreenPref(BOOT_TIMEOUT_MS);
    return Promise.resolve();
  }

  const started = Date.now();
  return loadFullscreenPref(BOOT_TIMEOUT_MS).then(
    (on) =>
      new Promise<void>((resolve) => {
        if (!on) {
          resolve();
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = () => {
          clearTimeout(timer);
          webApp.offEvent?.('fullscreenChanged', settle);
          webApp.offEvent?.('fullscreenFailed', settle);
          // Let the new safe-area CSS vars apply before the splash goes.
          requestAnimationFrame(() => resolve());
        };
        webApp.onEvent?.('fullscreenChanged', settle);
        webApp.onEvent?.('fullscreenFailed', settle);
        if (!ensureFullscreen()) {
          settle();
          return;
        }
        timer = setTimeout(settle, Math.max(150, BOOT_TIMEOUT_MS - (Date.now() - started)));
      }),
  );
}
