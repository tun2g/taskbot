import type { AdminRange } from '@tbot/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';

import { Segmented } from '@/components/ui/nav';
import { RANGE_LABELS } from '@/lib/labels';
import { DEFAULT_RANGE, RANGES } from '@/lib/search';

/** The date range of the page's numbers (only on pages that have them). */
export function RangeSelect() {
  const search = useSearch({ strict: false }) as { range?: AdminRange };
  const navigate = useNavigate();
  return (
    <Segmented
      label="Date range"
      value={search.range ?? DEFAULT_RANGE}
      options={RANGES.map((r) => ({
        value: r,
        label: r === '7d' ? '7 days' : r === '30d' ? '30 days' : '90 days',
        title: RANGE_LABELS[r],
      }))}
      onChange={(range) =>
        navigate({
          to: '.',
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            range: range === DEFAULT_RANGE ? undefined : range,
            page: undefined,
          }),
          replace: true,
        } as never)
      }
    />
  );
}
