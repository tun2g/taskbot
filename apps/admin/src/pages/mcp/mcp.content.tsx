import type { AdminMcpOverview, AdminRange } from '@tbot/shared';
import { mcpToolInfo } from '@tbot/shared';
import { Link, useNavigate } from '@tanstack/react-router';

import { DailyChart, ShareBar } from '@/components/charts/daily-chart';
import { TrackingNotice } from '@/components/tracking-notice';
import { GroupStatusBadge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi';
import { FilterChip } from '@/components/ui/nav';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { PersonCell, RelativeTime } from '@/components/ui/values';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber, formatPercent, plural } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';

/** "3 (4.2%)" — failures with their share; quiet grey when there are none. */
function Failures({ failed, calls }: { failed: number; calls: number }) {
  if (failed === 0) return <span className="text-text-3">0</span>;
  const rate = calls > 0 ? failed / calls : 0;
  return (
    <span className={cn(rate >= 0.1 ? 'font-medium text-danger' : 'text-text')}>
      {formatNumber(failed)} <span className="text-xs text-text-3">({formatPercent(rate, 1)})</span>
    </span>
  );
}

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
}) {
  const navigate = useNavigate();
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
  const failRate = data.calls > 0 ? data.failed / data.calls : 0;
  const refusedRate = data.calls + data.rateLimited > 0 ? data.rateLimited / (data.calls + data.rateLimited) : 0;
  const maxClient = Math.max(0, ...data.byClient.map((c) => c.calls));
  const maxUser = Math.max(0, ...data.topUsers.map((u) => u.calls));
  const scope = [tool && `the “${mcpToolInfo(tool).label}” tool`, client && `${client}`].filter(Boolean).join(' from ');

  return (
    <>
      {header}
      <div className="space-y-4">
        <TrackingNotice trackingSince={props.trackingSince} from={props.from} what="MCP calls before that day weren’t counted" />

        {filtered && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-2">
            Showing only
            {tool && <FilterChip label={<>Tool: {mcpToolInfo(tool).label}</>} onRemove={() => props.onFilter({ tool: undefined })} />}
            {client && <FilterChip label={<>Client: {client}</>} onRemove={() => props.onFilter({ client: undefined })} />}
            <span className="text-text-3">· Token numbers always cover everyone.</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Active tokens"
            value={formatNumber(data.activeTokens)}
            hint="Not revoked and not expired, right now. Each lets an AI client act as that person."
            footer={
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <a href="#tokens" className="text-accent-text hover:underline">
                  See the tokens ↓
                </a>
                <TextLink to="/users" search={{ hasTokens: true }}>
                  Held by {plural(data.tokenOwners, 'person', 'people')} →
                </TextLink>
              </p>
            }
          />
          <KpiCard
            label="MCP calls"
            value={formatNumber(data.calls, { compact: true })}
            hint={`Tool calls from AI clients · ${rangeLabel}${filtered ? ` · only ${scope}` : ''}. Broken down by tool, client, person and group below.`}
          />
          <KpiCard
            label="Failed calls"
            value={
              <span className={failRate >= 0.1 ? 'text-danger' : undefined}>
                {formatNumber(data.failed)} <span className="text-base font-medium text-text-3">({formatPercent(failRate, 1)})</span>
              </span>
            }
            hint="The tool returned an error: a task that doesn’t exist, no permission, bad input, or a bug. A few % is normal; see “By tool” for where."
          />
          <KpiCard
            label="Refused by rate limit"
            value={
              <>
                {formatNumber(data.rateLimited)}
                {!tool && <span className="text-base font-medium text-text-3"> ({formatPercent(refusedRate, 1)})</span>}
              </>
            }
            hint={
              tool
                ? 'Refused requests aren’t tied to a tool, so this counts every tool.'
                : 'Requests refused because a token sent too many too quickly (not counted in MCP calls). Many from one person usually means a looping client — see who below.'
            }
          />
        </div>

        {data.calls === 0 && data.rateLimited === 0 ? (
          <Card>
            <EmptyState
              title={filtered ? 'No MCP calls match this filter in this period.' : 'No one has used MCP in this period.'}
              body={
                filtered
                  ? 'Remove the filter to see every call.'
                  : 'People connect AI clients from the Mini App → Settings → AI tools. Calls show up here once they do.'
              }
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
              <Card>
                <CardHeader
                  title="By tool"
                  subtitle="What AI clients asked the bot to do. Click a tool to see who used it and in which groups."
                />
                <Table>
                  <THead>
                    <Th>Tool</Th>
                    <Th align="right">Calls</Th>
                    <Th align="right" hint="share of its calls">
                      Failed
                    </Th>
                  </THead>
                  <tbody>
                    {data.byTool.map((t) => {
                      const info = mcpToolInfo(t.tool);
                      const active = tool === t.tool;
                      return (
                        <Tr key={t.tool} onOpen={() => props.onFilter({ tool: active ? undefined : t.tool })} className={active ? 'bg-accent-soft/60' : undefined}>
                          <Td className="max-w-xs">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-medium text-text">{info.label}</span>
                              <span className={cn('text-[11px]', info.writes ? 'text-warn' : 'text-text-3')}>{info.writes ? 'changes tasks' : 'read-only'}</span>
                            </div>
                            <div className="text-xs text-text-3">{info.what}</div>
                          </Td>
                          <Td align="right">{formatNumber(t.calls)}</Td>
                          <Td align="right">
                            <Failures failed={t.failed} calls={t.calls} />
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader title="By client" subtitle="The app the AI runs in, as it names itself. Click to see only its calls." />
                  <ul className="divide-y divide-border border-t border-border">
                    {data.byClient.map((c) => {
                      const active = client === c.client;
                      return (
                        <li key={c.client}>
                          <button
                            type="button"
                            onClick={() => props.onFilter({ client: active ? undefined : c.client })}
                            className={cn('block w-full cursor-pointer px-4 py-2.5 text-left hover:bg-surface-2/70', active && 'bg-accent-soft/60')}
                          >
                            <div className="mb-1 flex justify-between gap-3 text-sm">
                              <span className="text-text">{c.client}</span>
                              <span className="text-text-2 tabular">
                                {plural(c.calls, 'call')}
                                {c.failed ? <span className="text-text-3"> · {formatNumber(c.failed)} failed</span> : null}
                              </span>
                            </div>
                            <ShareBar value={c.calls} max={maxClient} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
                <Card>
                  <CardHeader title="Top people" subtitle={`Who made the most MCP calls · ${rangeLabel}. Click to open the person.`} />
                  {data.topUsers.length === 0 ? (
                    <EmptyState compact title="No one in this period." />
                  ) : (
                    <ul className="divide-y divide-border border-t border-border">
                      {data.topUsers.map((u) => (
                        <li
                          key={u.person.telegramUserId}
                          className={u.person.id ? 'cursor-pointer px-4 py-2.5 hover:bg-surface-2/70' : 'px-4 py-2.5'}
                          onClick={u.person.id ? () => navigate({ to: '/users/$userId', params: { userId: u.person.id! }, search: { range } }) : undefined}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <PersonCell person={u.person} link={false} />
                            <span className="shrink-0 text-right text-sm text-text-2 tabular">
                              {plural(u.calls, 'call')}
                              {(u.failed || u.rateLimited) ? (
                                <span className="block text-xs text-text-3">
                                  {[u.failed ? `${formatNumber(u.failed)} failed` : null, u.rateLimited ? `${formatNumber(u.rateLimited)} refused` : null]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              ) : null}
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <ShareBar value={u.calls} max={maxUser} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.byGroup && (
                <Card>
                  <CardHeader title="By group" subtitle="Which group’s tasks the calls read or changed. Click to open the group." />
                  {data.byGroup.length === 0 ? (
                    <EmptyState compact title="No calls were tied to a group." body="Calls like “List groups” don’t belong to one group." />
                  ) : (
                    <Table>
                      <THead>
                        <Th>Group</Th>
                        <Th align="right">Calls</Th>
                        <Th align="right">Failed</Th>
                      </THead>
                      <tbody>
                        {data.byGroup.map((g) => (
                          <Tr
                            key={g.group.id}
                            onOpen={g.group.deleted ? undefined : () => navigate({ to: '/groups/$groupId', params: { groupId: g.group.id }, search: { range } })}
                          >
                            <Td>
                              <span className="flex flex-wrap items-center gap-2">
                                <span className={cn('font-medium', g.group.deleted ? 'text-text-3' : 'text-text')}>{g.group.name}</span>
                                {!g.group.deleted && <GroupStatusBadge status={g.group.status} />}
                              </span>
                            </Td>
                            <Td align="right">{formatNumber(g.calls)}</Td>
                            <Td align="right">
                              <Failures failed={g.failed} calls={g.calls} />
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card>
              )}
              {data.rateLimitedBy && (
                <Card>
                  <CardHeader
                    title="Refused by rate limit — who"
                    subtitle="People whose AI client sent requests too fast. If one person dominates, their client is probably looping; you can revoke their tokens on their page."
                  />
                  {data.rateLimitedBy.length === 0 ? (
                    <EmptyState compact title="No one was refused in this period." />
                  ) : (
                    <ul className="divide-y divide-border border-t border-border">
                      {data.rateLimitedBy.map((u) => (
                        <li key={u.person.telegramUserId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <PersonCell person={u.person} />
                          <span className="shrink-0 text-sm text-text-2 tabular">{plural(u.count, 'refused request')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          </>
        )}

        {data.tokens && (
          <Card>
            <div id="tokens" className="scroll-mt-4" />
            <CardHeader
              title="Active tokens"
              subtitle="Every token that works right now, newest first. To stop one, open its owner and revoke their tokens."
            />
            {data.tokens.length === 0 ? (
              <EmptyState compact title="No active tokens." body="People create tokens in the Mini App → Settings → AI tools." />
            ) : (
              <Table>
                <THead>
                  <Th>Token</Th>
                  <Th>Owner</Th>
                  <Th>Works in</Th>
                  <Th>Last used</Th>
                  <Th>Created</Th>
                  <Th>Expires</Th>
                </THead>
                <tbody>
                  {data.tokens.map((t) => (
                    <Tr
                      key={t.id}
                      onOpen={t.person?.id ? () => navigate({ to: '/users/$userId', params: { userId: t.person!.id! }, search: { range } }) : undefined}
                    >
                      <Td>
                        <div className="font-medium text-text">{t.name}</div>
                        <code className="font-mono text-xs text-text-3">{t.prefix}…</code>
                      </Td>
                      <Td className="max-w-48">
                        <PersonCell person={t.person} />
                      </Td>
                      <Td stop>
                        {t.group ? (
                          t.group.deleted ? (
                            <span className="text-text-3">{t.group.name}</span>
                          ) : (
                            <Link to="/groups/$groupId" params={{ groupId: t.group.id }} className="text-accent-text hover:underline">
                              {t.group.name}
                            </Link>
                          )
                        ) : (
                          <span className="text-text-2">All their groups</span>
                        )}
                      </Td>
                      <Td>
                        <RelativeTime value={t.lastUsedAt} never="Never used" />
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(t.createdAt)}</Td>
                      <Td className="whitespace-nowrap">{t.expiresAt ? formatDate(t.expiresAt) : <span className="text-text-3">Never</span>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
