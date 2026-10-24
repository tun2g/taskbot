import type { AdminAiOverrideInput, AdminGroupDetail, AdminRange, AiFeature } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import type { GroupLifecycleAction } from '@/components/actions/group-actions';
import { buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { type TabItem, Tabs } from '@/components/ui/nav';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import type { GroupTab } from '@/lib/search';

import { AiTab } from './components/ai-tab';
import { GroupHeader } from './components/group-header';
import { MembersTab } from './components/members-tab';
import { OverviewTab } from './components/overview-tab';
import { type AiLimits, SettingsTab } from './components/settings-tab';
import { TasksTab } from './components/tasks-tab';

export function GroupDetailContent({
  group,
  isLoading,
  isFetching,
  notFound,
  error,
  onRetry,
  range,
  tab,
  onTab,
  trackingSince,
  trackingLoaded,
  rangeFrom,
  onAction,
  busy,
  onSaveAi,
  savingAi,
  aiLimits,
  onOpenPerson,
  onOpenFeature,
}: {
  group: AdminGroupDetail | undefined;
  isLoading: boolean;
  isFetching: boolean;
  notFound: boolean;
  error: string | null;
  onRetry: () => void;
  range: AdminRange;
  tab: GroupTab;
  onTab: (tab: GroupTab) => void;
  trackingSince: string | null;
  trackingLoaded: boolean;
  rangeFrom: string;
  onAction: (action: GroupLifecycleAction, group: AdminGroupDetail) => void;
  busy: boolean;
  onSaveAi: (input: AdminAiOverrideInput) => void;
  savingAi: boolean;
  /** Limits that apply without an override (null while Settings load). */
  aiLimits: AiLimits | null;
  onOpenPerson: (userId: string) => void;
  onOpenFeature: (feature: AiFeature) => void;
}) {
  if (notFound) {
    return (
      <Card>
        <EmptyState
          title="This group no longer exists"
          body="It may have been deleted. Usage and cost history stay on the AI & cost page."
          action={
            <Link to="/groups" className={buttonClass('primary')}>
              Back to groups
            </Link>
          }
        />
      </Card>
    );
  }
  if (isLoading) return <PageSkeleton />;
  if (error && !group) {
    return (
      <Card>
        <ErrorState message={error} onRetry={onRetry} retrying={isFetching} title="Couldn’t load this group" />
      </Card>
    );
  }
  if (!group) return null;

  const tabs: TabItem<GroupTab>[] = [
    { value: 'overview', label: 'Overview', hint: 'Activity, tasks and usage in the selected range' },
    { value: 'tasks', label: 'Tasks', count: group.openTasks, hint: 'Open tasks, overdue, done and epics' },
    { value: 'members', label: 'People using the bot', count: group.knownMembers, hint: 'People in this group who used the bot' },
    { value: 'ai', label: 'AI', hint: 'AI calls and estimated cost by feature' },
    { value: 'settings', label: 'Settings', hint: 'AI limits and the danger zone' },
  ];

  return (
    <div className={isFetching ? 'opacity-90 transition-opacity' : undefined}>
      <GroupHeader group={group} onAction={(a) => onAction(a, group)} busy={busy} />
      <Tabs items={tabs} value={tab} onChange={onTab} className="mb-5" />
      {tab === 'overview' && (
        <OverviewTab
          group={group}
          range={range}
          trackingSince={trackingSince}
          trackingLoaded={trackingLoaded}
          rangeFrom={rangeFrom}
        />
      )}
      {tab === 'tasks' && <TasksTab group={group} />}
      {tab === 'members' && <MembersTab range={range} onOpenPerson={onOpenPerson} />}
      {tab === 'ai' && <AiTab group={group} range={range} globalLimit={aiLimits ? aiLimits.global : undefined} onOpenFeature={onOpenFeature} />}
      {tab === 'settings' && (
        <SettingsTab
          group={group}
          aiLimits={aiLimits}
          onSaveAi={onSaveAi}
          savingAi={savingAi}
          onAction={(a) => onAction(a, group)}
          busy={busy}
        />
      )}
    </div>
  );
}
