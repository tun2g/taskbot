import type { AdminUserRow } from '@tbot/shared';

import { AiOverrideBadge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { SearchInput, Select } from '@/components/ui/input';
import { FilterChip, Pagination } from '@/components/ui/nav';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { PersonCell, RelativeTime } from '@/components/ui/values';
import { formatMoney, formatNumber } from '@/lib/format';
import { USER_SORT_LABELS, type UserSort } from '@/lib/labels';
import type { ActiveWindow } from '@/lib/search';

const ACTIVE_LABELS: Record<ActiveWindow, string> = {
  today: 'Used the bot today (DAU)',
  '7d': 'Used the bot in the last 7 days (WAU)',
  '30d': 'Used the bot in the last 30 days (MAU)',
};

export function UsersContent(props: {
  rows: AdminUserRow[];
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  query: string;
  onQuery: (q: string) => void;
  searched: boolean;
  activeIn?: ActiveWindow;
  onClearActive: () => void;
  hasTokens: boolean;
  onClearTokens: () => void;
  sort: UserSort;
  onSort: (sort: UserSort) => void;
  onPage: (page: number) => void;
  onOpen: (userId: string) => void;
}) {
  const { rows } = props;
  const sortBy = (key: UserSort) => ({ active: props.sort === key, onSort: () => props.onSort(key) });
  return (
    <>
      <PageHeader
        title="People"
        subtitle="Everyone who has used the bot in any group. Open a person to see their groups, AI use and MCP tokens."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <SearchInput
            value={props.query}
            onChange={props.onQuery}
            placeholder="Search by name or @username"
            className="w-full sm:w-72"
          />
          <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-text-2">
            Sort by
            <Select value={props.sort} onChange={(e) => props.onSort(e.target.value as UserSort)}>
              {(Object.keys(USER_SORT_LABELS) as UserSort[]).map((s) => (
                <option key={s} value={s}>
                  {USER_SORT_LABELS[s]}
                </option>
              ))}
            </Select>
          </label>
          {props.activeIn && (
            <FilterChip
              label={
                <>
                  {ACTIVE_LABELS[props.activeIn]} · {formatNumber(props.total)}
                </>
              }
              onRemove={props.onClearActive}
            />
          )}
          {props.hasTokens && (
            <FilterChip label={<>Holds an active MCP token · {formatNumber(props.total)}</>} onRemove={props.onClearTokens} />
          )}
        </div>
        {props.isLoading ? (
          <TableSkeleton />
        ) : props.error ? (
          <ErrorState message={props.error} onRetry={props.onRetry} retrying={props.retrying} />
        ) : rows.length === 0 ? (
          props.hasTokens && !props.searched ? (
            <EmptyState title="No one holds an active MCP token." body="People create tokens in the Mini App → Settings → AI tools. Remove the filter to see everyone." />
          ) : props.activeIn && !props.searched ? (
            <EmptyState title="No one used the bot in this window." body="Remove the filter to see everyone." />
          ) : props.searched ? (
            <EmptyState
              title={`No one matches “${props.query}”.`}
              body="Search looks at names and Telegram usernames. People appear here once they use the bot."
            />
          ) : (
            <EmptyState
              title="No one has used the bot yet."
              body="People show up here after their first command, button tap or Mini App visit in an approved group."
            />
          )
        ) : (
          <>
            <Table>
              <THead>
                <Th>Person</Th>
                <Th align="right" hint="they’ve used the bot in">
                  Groups
                </Th>
                <Th sort={sortBy('lastSeen')} hint="anywhere">
                  Last seen
                </Th>
                <Th align="right" hint="commands, taps, Mini App & MCP · 30 days" sort={sortBy('events')}>
                  Activity
                </Th>
                <Th align="right" hint="30 days" sort={sortBy('aiCalls')}>
                  AI calls
                </Th>
                <Th align="right" hint="estimated · 30 days" sort={sortBy('aiCost')}>
                  AI cost
                </Th>
                <Th align="right" hint="active now" sort={sortBy('tokens')}>
                  MCP tokens
                </Th>
                <Th hint="your override">AI</Th>
              </THead>
              <tbody>
                {rows.map((u) => (
                  <Tr key={u.person.telegramUserId} onOpen={u.person.id ? () => props.onOpen(u.person.id!) : undefined}>
                    <Td>
                      <PersonCell person={u.person} link={false} />
                    </Td>
                    <Td align="right">{formatNumber(u.groups)}</Td>
                    <Td>
                      <RelativeTime value={u.lastSeenAt} />
                    </Td>
                    <Td align="right">{formatNumber(u.events30d)}</Td>
                    <Td align="right" stop>
                      {u.person.id && u.aiCalls30d > 0 ? (
                        <TextLink to="/ai" search={{ userId: u.person.id, range: '30d' }} title="See these AI calls one by one">
                          {formatNumber(u.aiCalls30d)}
                        </TextLink>
                      ) : (
                        <span className="text-text-3">0</span>
                      )}
                    </Td>
                    <Td align="right" stop>
                      {u.person.id && u.aiCalls30d > 0 ? (
                        <TextLink
                          to="/ai"
                          search={{ userId: u.person.id, range: '30d' }}
                          title="See the AI calls behind this cost"
                        >
                          {formatMoney(u.aiCostUsd30d)}
                        </TextLink>
                      ) : (
                        <span className="text-text-3">{formatMoney(u.aiCostUsd30d)}</span>
                      )}
                    </Td>
                    <Td align="right">
                      {u.activeTokens > 0 ? formatNumber(u.activeTokens) : <span className="text-text-3">None</span>}
                    </Td>
                    <Td>
                      <AiOverrideBadge disabled={u.aiDisabled} dailyLimit={u.aiDailyLimit} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={props.page} limit={props.limit} total={props.total} onPage={props.onPage} noun="people" />
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-text-3">
        Click a column name to sort. AI cost is estimated from token counts × your price table (Settings); click an AI number to see the calls behind it.
      </p>
    </>
  );
}
