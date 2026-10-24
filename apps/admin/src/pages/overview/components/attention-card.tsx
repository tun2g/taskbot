import type { AdminAttentionItem } from '@tbot/shared';
import { useRouter } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
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
      <p className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-5 py-3 text-sm text-text-2">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-good" />
        <span>
          <span className="font-medium text-text">All clear.</span> No failing jobs, unusual AI errors or spikes,
          refused requests or groups waiting over a day — checked against today (UTC) and the last 7 days.
        </span>
      </p>
    );
  }

  return (
    <section aria-label="Needs attention" className="rounded-2xl border border-border bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 pt-5 pb-3">
        <h2 className="text-[17px] font-semibold text-text">Needs attention</h2>
        <span className="text-[13px] text-text-3">Today (UTC) compared with the last 7 days. Each item opens the page that explains it.</span>
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
              className="group flex gap-3 px-5 py-4 transition-colors hover:bg-surface-2/60"
            >
              <span
                aria-hidden
                className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.severity === 'danger' ? 'bg-danger' : 'bg-warn')}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-text">{item.title}</span>
                  <Badge tone={item.severity === 'danger' ? 'danger' : 'warn'} dot={false}>
                    {item.severity === 'danger' ? 'Act now' : 'Worth a look'}
                  </Badge>
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-text-2">{item.detail}</span>
                <span className="mt-1 block text-sm text-accent-text sm:hidden">{item.linkLabel ?? 'Open'} →</span>
              </span>
              <span className="hidden shrink-0 self-center text-sm font-medium whitespace-nowrap text-accent-text group-hover:underline sm:inline">
                {item.linkLabel ?? 'Open'} →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
