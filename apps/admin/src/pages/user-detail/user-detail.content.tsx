import type { AdminAiOverrideInput, AdminRange, AdminUserDetail } from '@tbot/shared';
import { useNavigate } from '@tanstack/react-router';

import { AiOverrideForm } from '@/components/actions/ai-override-form';
import { DailyChart } from '@/components/charts/daily-chart';
import { TrackingNotice } from '@/components/tracking-notice';
import { AiOverrideBadge, GroupStatusBadge } from '@/components/ui/badge';
import { LinkButton, TextLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { Avatar } from '@/components/ui/values';
import { formatDate, formatMoney, formatNumber, personName } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';

import { AiFeatureTable } from './components/ai-feature-table';
import { TokensCard } from './components/tokens-card';

export function UserDetailContent(props: {
  user: AdminUserDetail | undefined;
  range: AdminRange;
  isLoading: boolean;
  notFound: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  trackingSince: string | null;
  from: string;
  defaultLimitText: string;
  savingAi: boolean;
  onSaveAi: (input: AdminAiOverrideInput) => void;
  revoking: boolean;
  onRevokeTokens: (name: string, done: () => void) => void;
}) {
  const navigate = useNavigate();
  const { user, range } = props;

  if (props.isLoading) return <PageSkeleton />;
  if (props.notFound)
    return (
      <EmptyState
        title="This person wasn’t found."
        body="They may have been removed, or the link is old."
        action={
          <LinkButton to="/users" variant="primary">
            Back to people
          </LinkButton>
        }
      />
    );
  if (props.error || !user)
    return <ErrorState message={props.error ?? 'No data.'} onRetry={props.onRetry} retrying={props.retrying} />;

  const name = personName(user.person);
  const userId = user.person.id ?? '';
  const rangeLabel = RANGE_LABELS[range].toLowerCase();
  const events = user.daily.reduce((s, d) => s + d.events, 0);
  const aiCalls = user.daily.reduce((s, d) => s + d.aiCalls, 0);
  const aiCost = user.daily.reduce((s, d) => s + d.aiCostUsd, 0);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={name} seed={user.person.telegramUserId} className="size-11 text-base" />
            {name}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {user.person.username && <span>@{user.person.username}</span>}
            <span>First used the bot on {formatDate(user.createdAt)}</span>
            <AiOverrideBadge disabled={user.aiDisabled} dailyLimit={user.aiDailyLimit} />
          </span>
        }
      />

      <div className="space-y-4">
        <TrackingNotice
          trackingSince={props.trackingSince}
          from={props.from}
          what="activity and AI numbers before that day are not available"
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Groups"
            value={formatNumber(user.groups)}
            hint="Groups where this person has used the bot. Listed below."
          />
          <KpiCard
            label="Activity"
            value={formatNumber(events)}
            hint={`Commands, button taps, Mini App and MCP requests · ${rangeLabel}.`}
          />
          <KpiCard
            label="AI cost"
            value={formatMoney(aiCost)}
            hint={`${formatNumber(aiCalls)} AI calls · ${rangeLabel}. Estimated from token counts × your price table.`}
            to="/ai"
            search={{ userId, range }}
            neutralDelta
          />
          <KpiCard
            label="Active MCP tokens"
            value={formatNumber(user.activeTokens)}
            hint="Tokens AI clients use to act as this person. See below."
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Activity per day" subtitle="Commands, button taps, Mini App and MCP requests." />
            <CardBody>
              <DailyChart
                ariaLabel="Activity per day"
                data={user.daily}
                series={[{ key: 'events', label: 'Activity', color: 'var(--series-1)' }]}
                trackedFrom={props.trackingSince}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="AI cost per day"
              subtitle="Estimated from token counts × your price table."
              action={
                <TextLink to="/ai" search={{ userId, range }} className="text-sm">
                  See calls
                </TextLink>
              }
            />
            <CardBody>
              <DailyChart
                ariaLabel="AI cost per day"
                data={user.daily}
                series={[{ key: 'aiCostUsd', label: 'AI cost', color: 'var(--series-1)' }]}
                format={(v) => formatMoney(v)}
                axisFormat={(v) => formatMoney(v, { axis: true, compact: true })}
                trackedFrom={props.trackingSince}
              />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Groups" subtitle={`Where ${name} uses the bot. Numbers are for the ${rangeLabel}.`} />
          {user.groupList.length === 0 ? (
            <EmptyState compact title={`${name} isn’t in any group the bot knows about.`} />
          ) : (
            <Table>
              <THead>
                <Th>Group</Th>
                <Th>Joined</Th>
                <Th align="right" hint="commands, taps, Mini App & MCP">
                  Activity
                </Th>
                <Th align="right" hint="estimated">
                  AI cost
                </Th>
              </THead>
              <tbody>
                {user.groupList.map((g) => (
                  <Tr
                    key={g.group.id}
                    onOpen={() => navigate({ to: '/groups/$groupId', params: { groupId: g.group.id }, search: { range } })}
                  >
                    <Td>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text">{g.group.name}</span>
                        <GroupStatusBadge status={g.group.status} />
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(g.joinedAt)}</Td>
                    <Td align="right">{formatNumber(g.events)}</Td>
                    <Td align="right" stop>
                      {g.aiCostUsd > 0 ? (
                        <TextLink to="/ai" search={{ userId, groupId: g.group.id, range }} title="See these AI calls">
                          {formatMoney(g.aiCostUsd)}
                        </TextLink>
                      ) : (
                        <span className="text-text-3">{formatMoney(0)}</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="AI use by feature"
            subtitle={`Which AI features ${name} used · ${rangeLabel}. Click a row to see the calls.`}
          />
          {user.aiByFeature.length === 0 ? (
            <EmptyState compact title={`${name} hasn’t used AI features in this period.`} />
          ) : (
            <AiFeatureTable rows={user.aiByFeature} userId={userId} range={range} />
          )}
        </Card>

        <TokensCard
          name={name}
          tokens={user.tokens}
          revoking={props.revoking}
          onRevoke={(done) => props.onRevokeTokens(name, done)}
        />

        <Card>
          <CardHeader
            title="AI limits for this person"
            subtitle="Overrides the defaults from Settings for this person, in every group."
          />
          <CardBody>
            <AiOverrideForm
              subject="person"
              disabled={user.aiDisabled}
              dailyLimit={user.aiDailyLimit}
              defaultLimitText={props.defaultLimitText}
              pending={props.savingAi}
              onSave={props.onSaveAi}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
