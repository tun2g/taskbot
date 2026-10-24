import { useState } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { getTheme, setTheme, type ThemeChoice } from '@/lib/theme';

import { NavIcon } from './icons';

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'Theme: follows your device',
  light: 'Theme: light',
  dark: 'Theme: dark',
};
const THEME_ICONS: Record<ThemeChoice, string> = { system: 'monitor', light: 'sun', dark: 'moon' };

/** Cycles device → light → dark; the icon shows the current choice. */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);
  const next = THEME_NEXT[theme];
  return (
    <Tooltip content={`${THEME_LABELS[theme]} — click for ${THEME_LABELS[next].replace('Theme: ', '')}`}>
      <button
        type="button"
        onClick={() => {
          setTheme(next);
          setThemeState(next);
        }}
        aria-label={THEME_LABELS[theme]}
        className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
      >
        <NavIcon name={THEME_ICONS[theme]} className="size-5" />
      </button>
    </Tooltip>
  );
}
