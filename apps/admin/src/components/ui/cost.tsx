import { cn } from '@/lib/cn';
import { formatMoney, formatNumber, plural } from '@/lib/format';

import { Tooltip } from './tooltip';

/**
 * An estimated cost. When some calls used a model with no price it is a lower bound: "≥ $0.7640" with
 * "2 unpriced" under it (never a bare "+").
 */
export function Cost({ usd, unpriced = 0, className }: { usd: number; unpriced?: number; className?: string }) {
  if (!unpriced) return <span className={cn('whitespace-nowrap', className)}>{formatMoney(usd)}</span>;
  return (
    <Tooltip
      content={`${plural(unpriced, 'call')} used a model with no price in your price table, so they count as $0 — the real cost is at least this.`}
    >
      <span className={cn('inline-flex flex-col items-end whitespace-nowrap', className)}>
        <span>≥ {formatMoney(usd)}</span>
        <span className="text-[13px] font-normal text-warn">{formatNumber(unpriced)} unpriced</span>
      </span>
    </Tooltip>
  );
}
