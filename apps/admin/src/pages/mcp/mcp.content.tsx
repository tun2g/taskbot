import type { AdminMcpOverview, AdminRange } from '@tbot/shared';
import { mcpToolInfo } from '@tbot/shared';
import type { ReactNode } from 'react';

import { DailyChart } from '@/components/charts/daily-chart';
import { TrackingNotice } from '@/components/tracking-notice';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { FilterChip } from '@/components/ui/nav';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { RANGE_LABELS } from '@/lib/labels';

import { ByClientCard } from './components/by-client-card';
import { ByGroupCard } from './components/by-group-card';
import { ByToolCard } from './components/by-tool-card';
import { McpKpis } from './components/mcp-kpis';
import { RateLimitedCard } from './components/rate-limited-card';
import { TopPeopleCard } from './components/top-people-card';

export function McpContent(props: {
  data: AdminMcpOverview | undefined;
  range: AdminRange;
  tool?: string;
  client?: string;
  onFilter: (next: { tool?: string; client?: string }) => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  trackingSince: string | null;
  from: string;
  onOpenPerson: (userId: string) => void;
  onOpenGroup: (groupId: string) => void;
  /** The active tokens card (paginated, loads on its own). */
  tokens: ReactNode;
}) {
  const { data, range, tool, client } = props;
  const header = (
    <PageHeader
      title="MCP"
      subtitle="AI clients like Claude Desktop and Cursor reading and changing tasks with a person’s token. People create tokens in the Mini App → Settings → AI tools."
    />
  );
  if (props.isLoading)
    return (
      <>
        {header}
        <PageSkeleton />
      </>
    );
  if (props.error || !data)
    return (
      <>
        {header}
        <ErrorState message={props.error ?? 'No data.'} onRetry={props.onRetry} retrying={props.retrying} />
      </>
    );

  const rangeLabel = RANGE_LABELS[range].toLowerCase();
  const filtered = !!(tool || client);
  const scope = [tool && `the “${mcpToolInfo(tool).label}” tool`, client && `${client}`].filter(Boolean).join(' from ');

  return (
    <>
      {header}
      <div className="space-y-4">
        <TrackingNotice trackingSince={props.trackingSince} from={props.from} what="MCP calls before that day weren’t counted" />
        {filtered && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-2">
            Showing only
            {tool && <FilterChip label={<>Tool: {mcpToolInfo(tool).label}</>} onRemove={() => props.onFilter({ tool: undefined })} />}
            {client && <FilterChip label={<>Client: {client}</>} onRemove={() => props.onFilter({ client: undefined })} />}
            <span className="text-text-3">· Token numbers always cover everyone.</span>
          </div>
        )}
        <McpKpis data={data} tool={tool} scope={scope} rangeLabel={rangeLabel} />

        {data.calls === 0 && data.rateLimited === 0 ? (
          <Card>
            <EmptyState
              title={filtered ? 'No MCP calls match this filter in this period.' : 'No one has used MCP in this period.'}
              body={filtered ? 'Remove the filter to see every call.' : 'People connect AI clients from the Mini App → Settings → AI tools. Calls show up here once they do.'}
            />
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader title="MCP calls per day" subtitle={`Every tool call from an AI client${filtered ? ` (${scope})` : ''}, in all groups.`} />
              <CardBody>
                <DailyChart
                  ariaLabel="MCP calls per day, succeeded and failed"
                  stacked
                  data={data.daily.map((d) => ({ day: d.day, ok: d.calls - (d.failed ?? 0), failed: d.failed ?? 0 }))}
                  series={[
                    { key: 'ok', label: 'Succeeded', color: 'var(--series-1)' },
                    { key: 'failed', label: 'Failed', color: 'var(--series-2)' },
                  ]}
                  trackedFrom={props.trackingSince}
                />
              </CardBody>
            </Card>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ByToolCard rows={data.byTool} tool={tool} onTool={(t) => props.onFilter({ tool: t })} />
              <div className="space-y-4">
                <ByClientCard rows={data.byClient} client={client} onClient={(c) => props.onFilter({ client: c })} />
                <TopPeopleCard rows={data.topUsers} rangeLabel={rangeLabel} onOpen={props.onOpenPerson} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.byGroup && <ByGroupCard rows={data.byGroup} onOpen={props.onOpenGroup} />}
              {data.rateLimitedBy && <RateLimitedCard rows={data.rateLimitedBy} />}
            </div>
          </>
        )}
        {props.tokens}
      </div>
    </>
  );
}
