import type { AdminAiCallRow, AiCallStatus, AiFeature, PaginatedResponse } from '@tbot/shared';
import { AI_CALL_STATUS_VALUES, AI_FEATURE_VALUES } from '@tbot/shared';
import { Fragment } from 'react';

import { AiStatusBadge, Badge } from '@/components/ui/badge';
import { Button, TextLink } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Pagination } from '@/components/ui/nav';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, Td, Th, THead } from '@/components/ui/table';
import { PersonCell, RelativeTime } from '@/components/ui/values';
import { formatDuration, formatMoney, formatNumber } from '@/lib/format';
import { AI_FEATURE_LABELS, AI_STATUS_LABELS, CHANNEL_LABELS, featureLabel } from '@/lib/labels';
import type { AiSearch } from '@/lib/search';

export function CallsTable({
  calls,
  loading,
  error,
  onRetry,
  retrying,
  status,
  feature,
  filtered,
  page,
  pageSize,
  onUpdate,
}: {
  calls: PaginatedResponse<AdminAiCallRow> | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  status?: AiCallStatus;
  feature?: AiFeature;
  filtered: boolean;
  page: number;
  pageSize: number;
  onUpdate: (patch: Partial<AiSearch>) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 px-5 pb-3">
        <label className="text-sm text-text-2">
          <span className="mb-1 block">Result</span>
          <Select
            value={status ?? ''}
            onChange={(e) => onUpdate({ status: (e.target.value || undefined) as AiCallStatus | undefined })}
          >
            <option value="">All results</option>
            {AI_CALL_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {AI_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm text-text-2">
          <span className="mb-1 block">Feature</span>
          <Select
            value={feature ?? ''}
            onChange={(e) => onUpdate({ feature: (e.target.value || undefined) as AiFeature | undefined })}
            className="max-w-full"
          >
            <option value="">All features</option>
            {AI_FEATURE_VALUES.map((f) => (
              <option key={f} value={f}>
                {AI_FEATURE_LABELS[f]}
              </option>
            ))}
          </Select>
        </label>
        {(status || feature) && (
          <Button size="sm" variant="ghost" onClick={() => onUpdate({ status: undefined, feature: undefined })}>
            Clear result & feature
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={onRetry} retrying={retrying} />
      ) : loading || !calls ? (
        <TableSkeleton rows={8} />
      ) : calls.data.length === 0 ? (
        <EmptyState
          title={filtered ? 'No AI calls match these filters.' : 'No AI calls in this period.'}
          body={
            filtered
              ? 'Try another result or feature, or remove the group / person filter at the top.'
              : 'When people use /ai, “Explain”, “Create tasks from messages” or “Split into subtasks”, each call shows up here.'
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <Th>When</Th>
              <Th>Feature</Th>
              <Th>Group</Th>
              <Th>Person</Th>
              <Th hint="AI model that answered">Model</Th>
              <Th>Result</Th>
              <Th align="right" hint="in / out">
                Tokens
              </Th>
              <Th align="right" hint="time to answer">
                Took
              </Th>
              <Th align="right" hint="estimated">
                Cost
              </Th>
            </THead>
            <tbody>
              {calls.data.map((c) => (
                <Fragment key={c.id}>
                  <tr className={c.error ? '' : 'border-b border-border last:border-b-0'}>
                    <Td>
                      <RelativeTime value={c.at} />
                    </Td>
                    <Td>
                      <span className="block max-w-56">{featureLabel(c.feature)}</span>
                      {c.channel && <span className="block text-[13px] text-text-3">via {CHANNEL_LABELS[c.channel]}</span>}
                    </Td>
                    <Td>
                      {c.group?.deleted ? (
                        <span className="text-text-3" title="This group was deleted after the call. Its cost still counts in the totals.">
                          Deleted group
                        </span>
                      ) : c.group ? (
                        <TextLink to="/groups/$groupId" params={{ groupId: c.group.id }} className="block max-w-48 truncate">
                          {c.group.name}
                        </TextLink>
                      ) : (
                        <span className="text-text-3" title="Made outside a group — e.g. in a private chat with the bot or from the Mini App home.">
                          No group
                        </span>
                      )}
                    </Td>
                    <Td>
                      <PersonCell person={c.person} />
                    </Td>
                    <Td>
                      <span className="font-mono text-[13px] text-text-2">{c.model}</span>
                    </Td>
                    <Td>
                      <AiStatusBadge status={c.status} />
                      {c.attempt > 1 && (
                        <span className="mt-0.5 block text-[13px] text-text-3" title="The bot retried after the first attempt failed.">
                          retry #{c.attempt}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <span className="whitespace-nowrap">
                        {formatNumber(c.inputTokens)} / {formatNumber(c.outputTokens)}
                      </span>
                      {c.cachedTokens > 0 && (
                        <span className="block text-[13px] text-text-3" title="Cached input tokens are billed at a lower price.">
                          of which {formatNumber(c.cachedTokens)} cached
                        </span>
                      )}
                    </Td>
                    <Td align="right" className="whitespace-nowrap text-text-2">
                      {c.latencyMs > 0 ? formatDuration(c.latencyMs) : '—'}
                    </Td>
                    <Td align="right" className="font-medium">
                      {c.priced ? (
                        formatMoney(c.costUsd)
                      ) : (
                        <Badge
                          tone="warn"
                          dot={false}
                          title={`“${c.model}” has no price in your price table, so this call counts as $0. Adding a price in Settings prices new calls only — each call keeps the cost recorded when it was made.`}
                        >
                          no price
                        </Badge>
                      )}
                    </Td>
                  </tr>
                  {c.error && (
                    <tr className="border-b border-border last:border-b-0">
                      <td colSpan={9} className="px-5 pt-0 pb-2.5 text-[13px] text-danger">
                        {c.error}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={page}
            limit={calls.meta.limit || pageSize}
            total={calls.meta.total}
            noun="calls"
            onPage={(p) => onUpdate({ page: p > 1 ? p : undefined })}
          />
        </>
      )}
    </>
  );
}
