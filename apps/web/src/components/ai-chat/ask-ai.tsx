import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { isInTelegram } from '@/lib/telegram';

import { consumeReopen } from './ai-chat-store';

const DESKTOP_QUERY = '(min-width: 768px)';

function subscribeDesktop(cb: () => void) {
  const media = window.matchMedia?.(DESKTOP_QUERY);
  media?.addEventListener?.('change', cb);
  return () => media?.removeEventListener?.('change', cb);
}

/** ≥ 768px → right-side drawer; below → full-height bottom sheet. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => !!window.matchMedia?.(DESKTOP_QUERY).matches,
    () => false,
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Open state of the "Ask AI" panel for a page, plus the "/" shortcut. `backHandler(onBack)`
 * returns what the page should pass to Layout's `onBack`, so Telegram's native BackButton
 * closes the sheet first.
 */
export function useAskAi() {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(() => {
    const reopen = consumeReopen();
    return reopen && typeof window !== 'undefined' && !!window.matchMedia?.(DESKTOP_QUERY).matches;
  });

  const openChat = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      // Another dialog (create task, delete) is open — don't stack the chat on top of it.
      if (document.querySelector('[role="dialog"][aria-modal]:not([data-ai-chat])')) return;
      e.preventDefault();
      setOpen(true);
      // The panel focuses its input on open; if it's already open, focus it now.
      window.requestAnimationFrame(() => document.getElementById('ai-chat-input')?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const backHandler = useCallback(
    (onBack: () => void) => (open && (isInTelegram() || !isDesktop) ? close : onBack),
    [open, isDesktop, close],
  );

  return { open, isDesktop, openChat, close, backHandler };
}

export function AskAiButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-keyshortcuts="/"
      title="Ask AI ( / )"
      className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition-colors active:bg-tg-secondary ${
        active ? 'tint-link border-transparent' : 'border-tg-separator text-tg-link hover:bg-tg-secondary'
      }`}
    >
      <span aria-hidden>✨</span>
      Ask AI
    </button>
  );
}
