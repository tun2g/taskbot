import type { AdminAiCallRow, AiCallStatus, AiFeature, PaginatedResponse } from '@tbot/shared';
import { AI_CALL_STATUS_VALUES, AI_FEATURE_VALUES } from '@tbot/shared';
import { Fragment } from 'react';

import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/nav';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, Th, THead } from '@/components/ui/table';
import { AI_FEATURE_LABELS, AI_STATUS_HINTS, AI_STATUS_LABELS } from '@/lib/labels';
import type { AiSearch } from '@/lib/search';

import { CallCells } from './call-row';

const COLUMNS = 7;

function CallsFilters({ status, feature, onUpdate }: { status?: AiCallStatus; feature?: AiFeature; onUpdate: (patch: Partial<AiSearch>) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3 px-5 pb-3">
      <Select
        label="Result"
        value={status ?? ''}
        onChange={(v) => onUpdate({ status: (v || undefined) as AiCallStatus | undefined })}
        options={[{ value: '', label: 'All results' }, ...AI_CALL_STATUS_VALUES.map((s) => ({ value: s, label: AI_STATUS_LABELS[s], hint: AI_STATUS_HINTS[s] }))]}
      />
      <Select
        label="Feature"
        value={feature ?? ''}
        onChange={(v) => onUpdate({ feature: (v || undefined) as AiFeature | undefined })}
        options={[{ value: '', label: 'All features' }, ...AI_FEATURE_VALUES.map((f) => ({ value: f, label: AI_FEATURE_LABELS[f] }))]}
      />
      {(status || feature) && (
        <Button size="sm" variant="ghost" onClick={() => onUpdate({ status: undefined, feature: undefined })}>
          Clear result & feature
        </Button>
      )}
    </div>
  );
}

export function CallsTable(props: {
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
  const { calls } = props;
  return (
    <>
      <CallsFilters status={props.status} feature={props.feature} onUpdate={props.onUpdate} />
      {props.error ? (
        <ErrorState message={props.error} onRetry={props.onRetry} retrying={props.retrying} />
      ) : props.loading || !calls ? (
        <TableSkeleton rows={8} />
      ) : calls.data.length === 0 ? (
        <EmptyState
          title={props.filtered ? 'No AI calls match these filters.' : 'No AI calls in this period.'}
          body={
            props.filtered
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
              <Th>Result</Th>
              <Th hint="model · tokens in → out · time">Details</Th>
              <Th align="right" hint="estimated">
                Est. AI cost
              </Th>
            </THead>
            <tbody>
              {calls.data.map((c) => (
                <Fragment key={c.id}>
                  <tr className={c.error ? '' : 'border-b border-border last:border-b-0'}>
                    <CallCells call={c} />
                  </tr>
                  {c.error && (
                    <tr className="border-b border-border last:border-b-0">
                      <td colSpan={COLUMNS} className="px-5 pt-0 pb-2.5 text-[13px] text-danger">
                        {c.error}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={props.page}
            limit={calls.meta.limit || props.pageSize}
            total={calls.meta.total}
            noun="calls"
            onPage={(p) => props.onUpdate({ page: p > 1 ? p : undefined })}
          />
        </>
      )}
    </>
  );
}
