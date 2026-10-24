import type {
  AdminAiBreakdownRow,
  AdminAiCallRow,
  AdminAiUsage,
  AdminRange,
  AiCallStatus,
  AiFeature,
  PaginatedResponse,
} from '@tbot/shared';

import { DailyChart } from '@/components/charts/daily-chart';
import { TextLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { FilterChip, Segmented } from '@/components/ui/nav';
import { ErrorState, Notice, Skeleton } from '@/components/ui/states';
import { TrackingNotice } from '@/components/tracking-notice';
import { formatMoney, formatNumber, plural } from '@/lib/format';
import { featureLabel, GROUP_BY_LABELS, RANGE_LABELS } from '@/lib/labels';
import { type AiSearch, GROUP_BY_VALUES } from '@/lib/search';

import { AiTotals } from './components/ai-totals';
import { BreakdownTable } from './components/breakdown-table';
import { CallsTable } from './components/calls-table';

export interface AiFilters {
  groupId?: string;
  groupLabel: string;
  userId?: string;
  userLabel: string;
  status?: AiCallStatus;
  feature?: AiFeature;
}

const GROUP_BY_TITLES: Record<AdminAiUsage['groupBy'], string> = {
  day: 'One row per day',
  feature: 'Which bot feature made the call',
  model: 'Which AI model answered',
  group: 'Which group the call was for',
  user: 'Who asked for it',
};

export function AiContent({
  range,
  groupBy,
  filters,
  usage,
  usageLoading,
  usageError,
  onRetryUsage,
  usageRetrying,
  dailyRows,
  dailyLoading,
  trackingSince,
  rangeFrom,
  calls,
  callsLoading,
  callsError,
  onRetryCalls,
  callsRetrying,
  page,
  pageSize,
  onUpdate,
}: {
  range: AdminRange;
  groupBy: AdminAiUsage['groupBy'];
  filters: AiFilters;
  usage: AdminAiUsage | undefined;
  usageLoading: boolean;
  usageError: string | null;
  onRetryUsage: () => void;
  usageRetrying: boolean;
  dailyRows: AdminAiBreakdownRow[] | undefined;
  dailyLoading: boolean;
  /** undefined while unknown (don't flash the notice). */
  trackingSince: string | null | undefined;
  rangeFrom: string;
  calls: PaginatedResponse<AdminAiCallRow> | undefined;
  callsLoading: boolean;
  callsError: string | null;
  onRetryCalls: () => void;
  callsRetrying: boolean;
  page: number;
  pageSize: number;
  onUpdate: (patch: Partial<AiSearch>, opts?: { scrollToCalls?: boolean }) => void;
}) {
  const scoped = !!filters.groupId || !!filters.userId;
  const chartData = (dailyRows ?? []).map((r) => ({ day: r.key, cost: r.costUsd, ok: r.calls - r.failed, failed: r.failed }));
  const unpriced = usage?.totals.unpriced ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI & cost"
        subtitle="What AI features cost and who uses them. Cost is estimated from token counts × your price table."
      >
        {scoped && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-3">Showing only:</span>
            {filters.groupId && (
              <FilterChip
                label={<>Group: {filters.groupLabel}</>}
                onRemove={() => onUpdate({ groupId: undefined })}
              />
            )}
            {filters.userId && (
              <FilterChip label={<>Person: {filters.userLabel}</>} onRemove={() => onUpdate({ userId: undefined })} />
            )}
          </div>
        )}
      </PageHeader>

      {trackingSince !== undefined && (
        <TrackingNotice trackingSince={trackingSince} from={rangeFrom} what="AI calls before that weren’t recorded" />
      )}

      {usageError ? (
        <Card>
          <ErrorState message={usageError} onRetry={onRetryUsage} retrying={usageRetrying} />
        </Card>
      ) : (
        <>
          <AiTotals totals={usage?.totals} loading={usageLoading} range={range} />

          {unpriced > 0 && (
            <Notice
              tone="warn"
              action={
                <TextLink to="/settings" className="text-sm font-medium whitespace-nowrap">
                  Open price table →
                </TextLink>
              }
            >
              {plural(unpriced, 'call')} used a model with no price in your price table, so they count as $0 — the cost
              shown is a lower bound. Add the model’s price in Settings — new calls are priced from then on; calls already made keep the cost they were recorded with.
            </Notice>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Estimated cost per day"
                subtitle={`${RANGE_LABELS[range]}, in US dollars (UTC days).`}
              />
              <CardBody>
                {dailyLoading ? (
                  <Skeleton className="h-[200px] w-full" />
                ) : (
                  <DailyChart
                    ariaLabel="Estimated AI cost per day"
                    data={chartData}
                    series={[{ key: 'cost', label: 'Estimated cost', color: 'var(--series-1)' }]}
                    format={(v) => formatMoney(v, { compact: true })}
                axisFormat={(v) => formatMoney(v, { axis: true, compact: true })}
                    trackedFrom={trackingSince ?? undefined}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="AI calls per day"
                subtitle="Each time the bot asked the model something. Failed = an error or an unusable reply. Requests refused by a limit never reach the model and aren't counted."
              />
              <CardBody>
                {dailyLoading ? (
                  <Skeleton className="h-[200px] w-full" />
                ) : (
                  <DailyChart
                    ariaLabel="AI calls per day, succeeded and failed"
                    data={chartData}
                    stacked
                    series={[
                      { key: 'ok', label: 'Succeeded', color: 'var(--series-1)' },
                      { key: 'failed', label: 'Failed', color: 'var(--series-2)' },
                    ]}
                    trackedFrom={trackingSince ?? undefined}
                  />
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Breakdown"
              subtitle={
                groupBy === 'day' || groupBy === 'model'
                  ? `${GROUP_BY_TITLES[groupBy]}. Day and model rows can’t be filtered yet — use the filters on the calls below.`
                  : `${GROUP_BY_TITLES[groupBy]}. Click a row to see its individual calls.`
              }
              action={
                <Segmented
                  label="Group the breakdown by"
                  size="sm"
                  value={groupBy}
                  options={GROUP_BY_VALUES.map((v) => ({ value: v, label: GROUP_BY_LABELS[v], title: GROUP_BY_TITLES[v] }))}
                  onChange={(v) => onUpdate({ groupBy: v === 'feature' ? undefined : v })}
                />
              }
            />
            <BreakdownTable
              usage={usage}
              loading={usageLoading}
              groupBy={groupBy}
              onDrill={(row) => {
                if (groupBy === 'feature') onUpdate({ feature: row.key as AiFeature }, { scrollToCalls: true });
                else if (groupBy === 'group' && row.key !== 'none') onUpdate({ groupId: row.key }, { scrollToCalls: true });
                else if (groupBy === 'user' && row.key !== 'none') onUpdate({ userId: row.key }, { scrollToCalls: true });
              }}
            />
          </Card>
        </>
      )}

      <Card>
        <div id="ai-calls" className="scroll-mt-20" />
        <CardHeader
          title="Individual calls"
          subtitle={
            <>
              Newest first. Every total above is the sum of these rows
              {filters.feature ? <> — showing “{featureLabel(filters.feature)}” only</> : null}.
            </>
          }
        />
        <CallsTable
          calls={calls}
          loading={callsLoading}
          error={callsError}
          onRetry={onRetryCalls}
          retrying={callsRetrying}
          status={filters.status}
          feature={filters.feature}
          filtered={scoped || !!filters.status || !!filters.feature}
          page={page}
          pageSize={pageSize}
          onUpdate={onUpdate}
        />
      </Card>
      {usage && usage.totals.calls > 0 && (
        <p className="text-[13px] text-text-3">
          {formatNumber(usage.totals.calls)} calls in this period cost an estimated {formatMoney(usage.totals.costUsd)}.
          Prices are set per model in <TextLink to="/settings">Settings</TextLink>.
        </p>
      )}
    </div>
  );
}
