import type { AdminAiOverrideInput, AdminMcpTokenRow, AdminRange, AdminUserDetail } from '@tbot/shared';

import type { TokenList } from '@/components/tokens/use-token-list';
import { TrackingNotice } from '@/components/tracking-notice';
import { LinkButton } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { personName } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';

import { AiFeatureTable } from './components/ai-feature-table';
import { AiLimitsCard } from './components/ai-limits-card';
import { GroupsTable } from './components/groups-table';
import { TokenHistoryCard } from './components/token-history-card';
import { TokensCard } from './components/tokens-card';
import { UserCharts } from './components/user-charts';
import { UserHeader } from './components/user-header';
import { UserKpis } from './components/user-kpis';

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
  rightNow: string;
  savingAi: boolean;
  onSaveAi: (input: AdminAiOverrideInput) => void;
  activeTokens: TokenList;
  endedTokens: TokenList;
  onRevokeToken: (token: AdminMcpTokenRow) => void;
  revokingAll: boolean;
  onRevokeAll: (name: string, done: () => void) => void;
}) {
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
  if (props.error || !user) return <ErrorState message={props.error ?? 'No data.'} onRetry={props.onRetry} retrying={props.retrying} />;

  const name = personName(user.person);
  const userId = user.person.id ?? '';
  const period = RANGE_LABELS[range].toLowerCase();

  return (
    <>
      <UserHeader user={user} />
      <div className="space-y-4">
        <TrackingNotice trackingSince={props.trackingSince} from={props.from} what="activity and AI numbers before that day are not available" />
        <UserKpis user={user} range={range} />
        <UserCharts user={user} range={range} trackingSince={props.trackingSince} />

        <Card>
          <div id="groups" className="scroll-mt-20" />
          <CardHeader title="Groups" subtitle={`Where ${name} uses the bot · ${period}. The rows add up to the totals at the top.`} />
          {user.groupList.length === 0 ? (
            <EmptyState compact title={`${name} isn’t in any group the bot knows about.`} />
          ) : (
            <GroupsTable rows={user.groupList} totals={user.totals} userId={userId} range={range} />
          )}
        </Card>

        <Card>
          <CardHeader title="AI use by feature" subtitle={`Which AI features ${name} used · ${period}. Click a row to see the calls.`} />
          {user.aiByFeature.length === 0 ? (
            <EmptyState compact title={`${name} hasn’t used AI features in this period.`} />
          ) : (
            <AiFeatureTable rows={user.aiByFeature} totals={user.totals} userId={userId} range={range} />
          )}
        </Card>

        <AiLimitsCard user={user} rightNow={props.rightNow} defaultLimitText={props.defaultLimitText} saving={props.savingAi} onSave={props.onSaveAi} />

        <TokensCard
          name={name}
          list={props.activeTokens}
          onRevokeOne={props.onRevokeToken}
          revokingAll={props.revokingAll}
          onRevokeAll={(done) => props.onRevokeAll(name, done)}
        />
        <TokenHistoryCard name={name} list={props.endedTokens} />
      </div>
    </>
  );
}
