import { SearchInput } from '@/components/ui/input';
import { FilterChip } from '@/components/ui/nav';
import { Select } from '@/components/ui/select';
import { formatNumber } from '@/lib/format';
import { USER_SORT_LABELS, type UserSort } from '@/lib/labels';
import type { ActiveWindow } from '@/lib/search';

const ACTIVE_LABELS: Record<ActiveWindow, string> = {
  today: 'Used the bot today (DAU)',
  '7d': 'Used the bot in the last 7 days (WAU)',
  '30d': 'Used the bot in the last 30 days (MAU)',
};

/** Search, the active filters, and — on phones only, where the table's column headers are off screen — a sort menu. */
export function UsersToolbar(props: {
  query: string;
  onQuery: (q: string) => void;
  total: number;
  activeIn?: ActiveWindow;
  onClearActive: () => void;
  hasTokens: boolean;
  onClearTokens: () => void;
  sort: UserSort;
  onSort: (sort: UserSort) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <SearchInput value={props.query} onChange={props.onQuery} placeholder="Search by name or @username" className="w-full sm:w-72" />
      <div className="sm:hidden">
        <Select
          label="Sort by"
          value={props.sort}
          onChange={props.onSort}
          options={(Object.keys(USER_SORT_LABELS) as UserSort[]).map((s) => ({ value: s, label: USER_SORT_LABELS[s] }))}
        />
      </div>
      {props.activeIn && (
        <FilterChip label={<>{ACTIVE_LABELS[props.activeIn]} · {formatNumber(props.total)}</>} onRemove={props.onClearActive} />
      )}
      {props.hasTokens && <FilterChip label={<>Holds an active MCP token · {formatNumber(props.total)}</>} onRemove={props.onClearTokens} />}
    </div>
  );
}
