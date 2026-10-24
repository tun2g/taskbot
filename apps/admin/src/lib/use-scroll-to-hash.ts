import { useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';

/** Scrolls to `#section` once the page has data (the element doesn't exist while it loads). */
export function useScrollToHash(ready: boolean) {
  const hash = useLocation({ select: (l) => l.hash });
  useEffect(() => {
    if (!ready || !hash) return;
    const t = setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    return () => clearTimeout(t);
  }, [ready, hash]);
}

/** Scroll to a section of the current page (for KPI cards that point at a table below). */
export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
