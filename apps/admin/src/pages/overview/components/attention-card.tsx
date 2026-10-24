import type { AdminAttentionItem } from '@tbot/shared';
import { useRouter } from '@tanstack/react-router';

import { cn } from '@/lib/cn';

/**
 * "Needs attention": anomalies to act on today, each opening the page that explains it. A calm one-liner when
 * there's nothing; nothing at all when the API didn't send the list (older API / it couldn't be computed).
 */
export function AttentionCard({ items }: { items: AdminAttentionItem[] | undefined }) {
  const router = useRouter();
  if (!items) return null;

  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[13px] text-text-2">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-good" />
        <span>
          <span className="font-medium text-text">All clear.</span> No failing jobs, unusual AI errors or spikes,
          refused requests or groups waiting over a day — checked against today (UTC) and the last 7 days.
        </span>
      </p>
    );
  }

  return (
    <section aria-label="Needs attention" className="rounded-xl border border-border bg-surface shadow-[var(--shadow)]">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-3.5 pb-2">
        <h2 className="text-[15px] font-semibold text-text">Needs attention</h2>
        <span className="text-xs text-text-3">Today (UTC) compared with the last 7 days. Each item opens the page that explains it.</span>
      </header>
      <ul className="divide-y divide-border border-t border-border">
        {items.map((item, i) => (
          <li key={`${item.kind}-${i}`}>
            <a
              href={item.link}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                router.history.push(item.link);
              }}
              className="group flex gap-3 px-4 py-3 hover:bg-surface-2/60"
            >
              <span
                aria-hidden
                className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.severity === 'danger' ? 'bg-danger' : 'bg-warn')}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-text">{item.title}</span>
                  <span className={cn('text-[11px] font-semibold tracking-wide uppercase', item.severity === 'danger' ? 'text-danger' : 'text-warn')}>
                    {item.severity === 'danger' ? 'Act now' : 'Worth a look'}
                  </span>
                </span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-text-2">{item.detail}</span>
                <span className="mt-1 block text-[13px] text-accent-text sm:hidden">{item.linkLabel ?? 'Open'} →</span>
              </span>
              <span className="hidden shrink-0 self-center text-[13px] whitespace-nowrap text-accent-text group-hover:underline sm:inline">
                {item.linkLabel ?? 'Open'} →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
