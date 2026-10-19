const TOKEN_KEY = 'tbot.token';

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage unavailable (private mode) — the session lasts until reload
    memoryToken = token;
  }
}

export function clearToken() {
  memoryToken = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

let memoryToken: string | null = null;

export function getStoredToken(): string | null {
  return getToken() ?? memoryToken;
}

/** Only allow same-origin paths as post-login redirect targets. */
export function safeRedirect(target: unknown): string {
  if (typeof target !== 'string') return '/';
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/login')) return '/';
  return target;
}
