/**
 * Light / dark / follow-the-OS. The choice lives in localStorage (a per-browser convenience) and is applied as
 * html[data-theme]; index.html applies it before first paint so there's no flash.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'tbot-admin-theme';

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage blocked — still applies for this page view */
  }
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}
