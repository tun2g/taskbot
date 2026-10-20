import { useEffect, useState } from 'react';

import { Dialog } from '@/components/ui/dialog';
import { canFullscreen, getFullscreenPref, getTelegramWebApp, haptic, setFullscreenPref, supportsTelegram } from '@/lib/telegram';

/**
 * Telegram's ⋯ menu → "Settings" (WebApp.SettingsButton, Bot API 7.0+). Its label is fixed,
 * so it opens this small sheet with the one setting we have: full screen on / off.
 * Only shown on phones that can go fullscreen.
 */
export function DisplaySettings() {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(getFullscreenPref);

  useEffect(() => {
    const button = getTelegramWebApp()?.SettingsButton;
    if (!button || !canFullscreen() || !supportsTelegram('7.0')) return;
    const onClick = () => {
      setFullscreen(getFullscreenPref());
      setOpen(true);
    };
    try {
      button.onClick(onClick);
      button.show();
    } catch {
      return;
    }
    return () => {
      try {
        button.offClick(onClick);
        button.hide();
      } catch {
        // ignore
      }
    };
  }, []);

  if (!open) return null;

  const toggle = () => {
    const next = !fullscreen;
    setFullscreen(next);
    setFullscreenPref(next);
    haptic('light');
  };

  return (
    <Dialog title="Settings" size="sm" onClose={() => setOpen(false)}>
      <button
        type="button"
        role="switch"
        aria-checked={fullscreen}
        onClick={toggle}
        className="mb-2 flex min-h-12 w-full items-center gap-3 rounded-xl bg-tg-secondary px-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base text-tg-text">Full screen</span>
          <span className="block text-xs text-tg-hint">Open the app edge-to-edge on this phone</span>
        </span>
        <span
          aria-hidden
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            fullscreen ? 'bg-tg-button' : 'bg-tg-hint/40'
          }`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
              fullscreen ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </span>
      </button>
    </Dialog>
  );
}
