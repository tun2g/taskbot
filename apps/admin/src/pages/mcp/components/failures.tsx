import { cn } from '@/lib/cn';
import { formatNumber, formatPercent } from '@/lib/format';

/** "3 (4.2%)" — failures with their share; quiet grey when there are none. */
export function Failures({ failed, calls }: { failed: number; calls: number }) {
  if (failed === 0) return <span className="text-text-3">0</span>;
  const rate = calls > 0 ? failed / calls : 0;
  return (
    <span className={cn(rate >= 0.1 ? 'font-medium text-danger' : 'text-text')}>
      {formatNumber(failed)} <span className="text-[13px] text-text-3">({formatPercent(rate, 1)})</span>
    </span>
  );
}
