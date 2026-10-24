import { safeRedirect } from './search';

/**
 * Where to go after login. The login link opens from Telegram — usually in a new tab — so the target is kept
 * in localStorage (not sessionStorage) between "Send login link" and /login/callback.
 */
const KEY = 'tbot-admin:redirect';

export function storeRedirect(path: string | undefined) {
  try {
    if (path) localStorage.setItem(KEY, path);
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked — fall back to the overview after login
  }
}

export function takeRedirect(): string {
  try {
    const value = safeRedirect(localStorage.getItem(KEY));
    localStorage.removeItem(KEY);
    return value ?? '/';
  } catch {
    return '/';
  }
}
