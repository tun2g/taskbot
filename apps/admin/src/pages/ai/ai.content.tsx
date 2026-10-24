import type { AdminAiBreakdownRow, AdminAiCallRow, AdminAiUsage, AdminRange, AiCallStatus, AiFeature, PaginatedResponse } from '@tbot/shared';

import { TrackingNotice } from '@/components/tracking-notice';
import { TextLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState, Notice } from '@/components/ui/states';
import { plural } from '@/lib/format';
import { featureLabel } from '@/lib/labels';
import type { AiSearch } from '@/lib/search';

import { AiCharts } from './components/ai-charts';
import { AiHeader } from './components/ai-header';
import { AiTotals } from './components/ai-totals';
import { BreakdownCard } from './components/breakdown-card';
import { CallsTable } from './components/calls-table';
import { RefusedCard } from './components/refused-card';
import type { RefusedList } from './use-refused';

export interface AiFilters {
  groupId?: string;
  groupLabel: string;
  groupDeleted?: boolean;
  userId?: string;
  userLabel: string;
  status?: AiCallStatus;
  feature?: AiFeature;
}

export function AiContent(props: {
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
  refused: RefusedList;
  calls: PaginatedResponse<AdminAiCallRow> | undefined;
  callsLoading: boolean;
  callsError: string | null;
  onRetryCalls: () => void;
  callsRetrying: boolean;
  page: number;
  pageSize: number;
  onUpdate: (patch: Partial<AiSearch>, opts?: { scrollToCalls?: boolean }) => void;
}) {
  const { range, filters, usage, onUpdate } = props;
  const scoped = !!filters.groupId || !!filters.userId;
  const unpriced = usage?.totals.unpriced ?? 0;

  return (
    <div className="space-y-5">
      <AiHeader filters={filters} range={range} onUpdate={onUpdate} />
      {props.trackingSince !== undefined && (
        <TrackingNotice trackingSince={props.trackingSince} from={props.rangeFrom} what="AI calls before that weren’t recorded" />
      )}

      {props.usageError ? (
        <Card>
          <ErrorState message={props.usageError} onRetry={props.onRetryUsage} retrying={props.usageRetrying} />
        </Card>
      ) : (
        <>
          <AiTotals totals={usage?.totals} loading={props.usageLoading} range={range} />
          {unpriced > 0 && (
            <Notice
              tone="warn"
              action={
                <TextLink to="/settings" className="text-sm font-medium whitespace-nowrap">
                  Open price table →
                </TextLink>
              }
            >
              {plural(unpriced, 'call')} used a model with no price in your price table, so they count as $0 — costs are shown as “≥”.
              Add the model’s price in Settings — new calls are priced from then on; calls already made keep the cost they were recorded with.
            </Notice>
          )}
          <AiCharts rows={props.dailyRows} loading={props.dailyLoading} range={range} trackingSince={props.trackingSince} />
          <BreakdownCard usage={usage} loading={props.usageLoading} groupBy={props.groupBy} range={range} onUpdate={onUpdate} />
          {(usage?.totals.refused ?? 0) > 0 && <RefusedCard list={props.refused} byReason={usage?.refusedByReason ?? []} range={range} />}
        </>
      )}

      <Card>
        <div id="ai-calls" className="scroll-mt-20" />
        <CardHeader
          title="Individual calls"
          subtitle={
            <>
              Newest first. Every total above is the sum of these rows{filters.feature ? <> — showing “{featureLabel(filters.feature)}” only</> : null}.
            </>
          }
        />
        <CallsTable
          calls={props.calls}
          loading={props.callsLoading}
          error={props.callsError}
          onRetry={props.onRetryCalls}
          retrying={props.callsRetrying}
          status={filters.status}
          feature={filters.feature}
          filtered={scoped || !!filters.status || !!filters.feature}
          page={props.page}
          pageSize={props.pageSize}
          onUpdate={onUpdate}
        />
      </Card>
    </div>
  );
}
