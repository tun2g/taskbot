import type { ReactNode } from 'react';

import { Badge, type Tone } from '@/components/ui/badge';

/** One health tile: what it is, a status badge, the headline value and an explanation. */
export function StatusCard({
  title,
  badge,
  value,
  children,
}: {
  title: string;
  badge: { tone: Tone; text: string };
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-medium text-text-2">{title}</span>
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>
      <div className="mt-1.5 text-xl font-semibold text-text tabular">{value}</div>
      <div className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-text-3">{children}</div>
    </div>
  );
}
