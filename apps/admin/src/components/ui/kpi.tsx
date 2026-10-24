import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatDelta } from '@/lib/format';

/**
 * A headline number. Every KPI links to the page that explains it, carries a plain-language subtitle,
 * and (when there is a previous period) shows the change.
 */
export function KpiCard({
  label,
  value,
  hint,
  previous,
  current,
  to,
  search,
  params,
  footer,
  neutralDelta = false,
  previousMissing = false,
}: {
  label: string;
  value: ReactNode;
  hint: ReactNode;
  current?: number;
  previous?: number;
  to?: LinkProps['to'];
  search?: LinkProps['search'];
  params?: LinkProps['params'];
  footer?: ReactNode;
  /** Colour the change neutrally — for cost and call counts a rise isn't necessarily bad (or good). */
  neutralDelta?: boolean;
  /** The previous period lies (partly) before tracking started, so a comparison would be meaningless. */
  previousMissing?: boolean;
}) {
  const delta = current != null && previous != null && !previousMissing ? formatDelta(current, previous) : null;
  // Green/red only for an unambiguous rise or fall; "New this period" (nothing to compare with) stays neutral.
  const deltaTone =
    !delta || delta.direction === 'flat' || neutralDelta || previous === 0
      ? 'text-text-2'
      : delta.direction === 'up'
        ? 'text-good'
        : 'text-danger';

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-medium text-text-2">{label}</span>
        {to && (
          <span aria-hidden className="text-text-3 transition-transform group-hover:translate-x-0.5">
            →
          </span>
        )}
      </div>
      <div className="mt-2 text-[30px] leading-tight font-bold tracking-tight text-text tabular">{value}</div>
      {previousMissing && current != null && (
        <div className="mt-0.5 text-[13px] text-text-3">No data for the previous period (before tracking started)</div>
      )}
      {delta && (
        <div className={cn('mt-0.5 text-[13px] font-medium tabular', deltaTone)}>
          {delta.text} <span className="font-normal text-text-3">vs previous period</span>
        </div>
      )}
      <p className="mt-2.5 text-sm leading-relaxed text-text-3">{hint}</p>
      {footer}
    </>
  );

  const cls = 'group block rounded-2xl border border-border bg-surface p-5';
  if (!to) return <div className={cls}>{body}</div>;
  return (
    <Link to={to} search={search} params={params} className={cn(cls, 'transition-colors hover:border-accent/50 hover:bg-accent-soft/30')}>
      {body}
    </Link>
  );
}
