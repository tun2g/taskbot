import { getRouteApi } from '@tanstack/react-router';

import { useGroup, useSetGroupAi } from '@/api/groups';
import { useAiSettings } from '@/api/settings';
import { useGroupLifecycle } from '@/components/actions/group-actions';
import { rangeStart, useTrackingSince } from '@/components/tracking-notice';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';
import { DEFAULT_RANGE, type GroupTab } from '@/lib/search';

import { GroupDetailContent } from './group-detail.content';
import { effectiveAiLimits } from './group-detail.utils';

const route = getRouteApi('/_app/groups/$groupId');

export function GroupDetailContainer() {
  const { groupId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const range = search.range ?? DEFAULT_RANGE;
  const tab: GroupTab = search.tab ?? 'overview';

  const group = useGroup(groupId, range);
  const tracking = useTrackingSince(range);
  const setAi = useSetGroupAi();
  const aiSettings = useAiSettings();
  const lifecycle = useGroupLifecycle({ onDeleted: () => void navigate({ to: '/groups', search: {} }) });

  return (
    <>
      <GroupDetailContent
        group={group.data}
        isLoading={group.isLoading}
        isFetching={group.isFetching}
        notFound={getErrorStatus(group.error) === 404}
        error={group.isError ? getErrorMessage(group.error) : null}
        onRetry={() => void group.refetch()}
        range={range}
        tab={tab}
        onTab={(t) =>
          void navigate({ search: (prev) => ({ ...prev, tab: t === 'overview' ? undefined : t, q: undefined, page: undefined }), replace: true })
        }
        trackingSince={tracking.trackingSince}
        trackingLoaded={tracking.loaded}
        rangeFrom={rangeStart(range)}
        onAction={lifecycle.request}
        busy={!!lifecycle.pendingId}
        onSaveAi={(input) => setAi.mutate({ id: groupId, ...input })}
        savingAi={setAi.isPending}
        aiLimits={effectiveAiLimits(aiSettings.data)}
        onOpenPerson={(userId) => void navigate({ to: '/users/$userId', params: { userId } })}
        onOpenFeature={(feature) => void navigate({ to: '/ai', search: { groupId, feature, range } })}
      />
      {lifecycle.dialog}
    </>
  );
}
