import type { AdminGroupDetail, AdminRange, UsageChannel } from '@tbot/shared';
import { USAGE_CHANNEL_VALUES, UsageKind } from '@tbot/shared';

import { DailyChart } from '@/components/charts/daily-chart';
import { TrackingNotice } from '@/components/tracking-notice';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi';
import { EmptyState } from '@/components/ui/states';
import { Table, Td, Th, THead, TotalRow, Tr } from '@/components/ui/table';
import { formatMoney, formatNumber, plural } from '@/lib/format';
import { CHANNEL_HINTS, CHANNEL_LABELS, RANGE_LABELS, USAGE_KIND_LABELS } from '@/lib/labels';

const KIND_HINTS: Record<UsageKind, string> = {
  [UsageKind.COMMAND]: 'Slash commands like /task or /mytasks',
  [UsageKind.CALLBACK]: 'Taps on the bot’s inline buttons',
  [UsageKind.MENTION]: 'Messages that @mention the bot',
  [UsageKind.API]: 'Board loads and edits in the Mini App',
  [UsageKind.MCP_TOOL]: 'Tool calls from AI clients with an MCP token',
  [UsageKind.RATE_LIMITED]: 'Requests refused because someone sent too many too fast',
};

const CHANNEL_COLORS: Record<UsageChannel, string> = {
  telegram: 'var(--series-1)',
  app: 'var(--series-2)',
  mcp: 'var(--series-3)',
};

export function OverviewTab({
  group,
  range,
  trackingSince,
  trackingLoaded,
  rangeFrom,
}: {
  group: AdminGroupDetail;
  range: AdminRange;
  trackingSince: string | null;
  trackingLoaded: boolean;
  rangeFrom: string;
}) {
  const trackedFrom = trackingLoaded ? trackingSince : undefined;
  const rows = group.daily.map((d) => ({
    day: d.day,
    activeUsers: d.activeUsers,
    tasksCreated: d.tasksCreated,
    aiCalls: d.aiCalls,
    telegram: d.channels.telegram ?? 0,
    app: d.channels.app ?? 0,
    mcp: d.channels.mcp ?? 0,
  }));
  const aiCost = group.daily.reduce((s, d) => s + d.aiCostUsd, 0);
  const aiCalls = group.daily.reduce((s, d) => s + d.aiCalls, 0);
  const rangeText = RANGE_LABELS[range].toLowerCase();
  const usage = [...group.usage].sort((a, b) => b.count - a.count);
  const usageTotal = usage.reduce((s, u) => s + u.count, 0);

  return (
    <div className="space-y-4">
      {trackingLoaded && (
        <TrackingNotice
          trackingSince={trackingSince}
          from={rangeFrom}
          what="earlier days have task counts only; activity and AI charts start that day"
        />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Open tasks"
          value={formatNumber(group.openTasks)}
          hint={`Not done yet, out of ${plural(group.tasks, 'task')} in total (all time).`}
        />
        <KpiCard label="Epics" value={formatNumber(group.counts.epics)} hint="Groupings of related tasks, all time." />
        <KpiCard
          label="Members"
          value={formatNumber(group.knownMembers)}
          hint="People in this group who have used the bot. Open the list →"
          to="/groups/$groupId"
          params={{ groupId: group.id }}
          search={{ tab: 'members' }}
        />
        <KpiCard
          label="Active MCP tokens"
          value={formatNumber(group.counts.activeTokens)}
          hint="Tokens made only for this group (deleting the group revokes them). Members' all-group tokens also reach it — see each member's count in Members →"
          to="/groups/$groupId"
          params={{ groupId: group.id }}
          search={{ tab: 'members' }}
        />
        <KpiCard
          label="AI cost"
          value={formatMoney(aiCost)}
          hint={`${plural(aiCalls, 'AI call')} in the ${rangeText}. Estimated from token counts × your price table. See every call →`}
          to="/ai"
          search={{ groupId: group.id, range }}
          neutralDelta
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Active people per day" subtitle="People who used the bot in this group that day (chat, Mini App or MCP)." />
          <CardBody>
            <DailyChart
              kind="line"
              data={rows}
              series={[{ key: 'activeUsers', label: 'Active people', color: 'var(--series-1)' }]}
              trackedFrom={trackedFrom}
              ariaLabel="Active people per day in this group"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Tasks created per day" subtitle="New tasks in this group, from any channel. Counted from tasks, so earlier days are included." />
          <CardBody>
            <DailyChart
              data={rows}
              series={[{ key: 'tasksCreated', label: 'Tasks created', color: 'var(--series-1)' }]}
              ariaLabel="Tasks created per day in this group"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="AI calls per day"
            subtitle="Every request the bot sent to the AI model for this group, including failed ones."
          />
          <CardBody>
            <DailyChart
              data={rows}
              series={[{ key: 'aiCalls', label: 'AI calls', color: 'var(--series-1)' }]}
              trackedFrom={trackedFrom}
              ariaLabel="AI calls per day in this group"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Where requests came from" subtitle="Requests to the bot per day, by channel." />
          <CardBody>
            <DailyChart
              data={rows}
              stacked
              series={USAGE_CHANNEL_VALUES.map((c) => ({ key: c, label: CHANNEL_LABELS[c], color: CHANNEL_COLORS[c] }))}
              trackedFrom={trackedFrom}
              ariaLabel="Requests per day by channel in this group"
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Usage by channel and kind"
          subtitle={`What people did with the bot in this group, ${rangeText}.`}
        />
        {usage.length === 0 ? (
          <EmptyState compact title="Nobody used the bot here in this period." body="Try a longer date range." />
        ) : (
          <Table>
            <THead>
              <Th>Channel</Th>
              <Th>Kind</Th>
              <Th align="right">Requests</Th>
            </THead>
            <tbody>
              {usage.map((u) => (
                <Tr key={`${u.channel}-${u.kind}`}>
                  <Td>
                    <span className="block text-text">{CHANNEL_LABELS[u.channel]}</span>
                    <span className="block text-xs text-text-3">{CHANNEL_HINTS[u.channel]}</span>
                  </Td>
                  <Td>
                    <span className="block text-text">{USAGE_KIND_LABELS[u.kind]}</span>
                    <span className="block text-xs text-text-3">{KIND_HINTS[u.kind]}</span>
                  </Td>
                  <Td align="right">{formatNumber(u.count)}</Td>
                </Tr>
              ))}
              <TotalRow>
                <Td>Total</Td>
                <Td />
                <Td align="right">{formatNumber(usageTotal)}</Td>
              </TotalRow>
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
