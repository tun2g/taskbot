import { useEffect, useRef } from 'react';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

interface LoadMoreProps {
  onLoadMore: () => void;
  isLoading: boolean;
  /** Tasks not loaded yet, shown as "Load more (12 left)". */
  remaining?: number;
  /** Load automatically when the button scrolls into view (the button stays as a fallback). */
  auto?: boolean;
  /** Hold off auto-loading (e.g. while the list refetches); resumes when it flips back. */
  paused?: boolean;
  className?: string;
}

/**
 * "Load more (N left)" at the end of a paged list. With `auto`, it also loads as soon as it comes
 * within ~300px of the viewport, and keeps going while it stays visible.
 */
export function LoadMore({ onLoadMore, isLoading, remaining, auto = true, paused, className = '' }: LoadMoreProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const loadRef = useRef(onLoadMore);
  loadRef.current = onLoadMore;

  useEffect(() => {
    const node = ref.current;
    if (!auto || isLoading || paused || !node || typeof IntersectionObserver === 'undefined') return;
    // A fresh observer after each load reports the current state at once, so a list that is
    // still too short to scroll keeps filling up.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadRef.current();
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [auto, isLoading, paused]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onLoadMore}
      disabled={isLoading}
      aria-busy={isLoading || undefined}
      className={`focus-ring flex min-h-11 w-full items-center justify-center gap-2 rounded-md text-sm font-medium text-tg-link transition-colors enabled:hover:bg-tg-bg/60 enabled:active:bg-tg-bg/60 disabled:text-tg-hint ${className}`}
    >
      {isLoading ? (
        <>
          <Spinner /> Loading…
        </>
      ) : remaining && remaining > 0 ? (
        `Load more (${remaining} left)`
      ) : (
        'Load more'
      )}
    </button>
  );
}
