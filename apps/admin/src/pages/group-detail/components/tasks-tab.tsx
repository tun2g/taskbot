import type { AdminGroupDetail, AdminGroupTaskFilter } from '@tbot/shared';

import { useGroupTasks } from '@/api/groups';
import { Card, CardHeader } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/input';
import { FilterChip, Segmented } from '@/components/ui/nav';
import { formatNumber } from '@/lib/format';
import { RANGE_LABELS } from '@/lib/labels';
import type { GroupTaskView } from '@/lib/search';
import { useUrlSearchBox } from '@/lib/use-url-search-box';

import { useDetailSearch } from '../use-detail-search';
import { EpicsList } from './epics-list';
import { TaskList } from './task-list';

const VIEW_LABELS: Record<GroupTaskView, string> = {
  open: 'Open',
  overdue: 'Overdue',
  done: 'Done',
  all: 'All tasks',
  epics: 'Epics',
};

/** Read-only lists behind the group's task numbers: open / overdue / done / all tasks, and its epics. */
export function TasksTab({ group }: { group: AdminGroupDetail }) {
  const { groupId, search, update } = useDetailSearch();
  const view: GroupTaskView = search.view ?? 'open';
  const page = search.page ?? 1;
  const filter: AdminGroupTaskFilter = view === 'epics' ? 'open' : view;
  // Same query as the list below (shared cache): its `counts` label the switch.
  const tasks = useGroupTasks(groupId, { filter, createdIn: search.createdIn, q: search.q, page, limit: 25 }, { enabled: view !== 'epics' });
  const counts = tasks.data?.counts;
  const box = useUrlSearchBox(search.q, (q) => update({ q, page: undefined }));

  const count = (v: GroupTaskView) => (v === 'epics' ? group.counts.epics : counts?.[v]);
  const options = (Object.keys(VIEW_LABELS) as GroupTaskView[]).map((v) => ({
    value: v,
    label: count(v) != null ? `${VIEW_LABELS[v]} · ${formatNumber(count(v)!)}` : VIEW_LABELS[v],
  }));

  return (
    <Card>
      <CardHeader
        title="Tasks"
        subtitle="What this group’s task numbers are made of. Read-only — people change tasks in Telegram or the Mini App. Only titles are shown, never descriptions or messages."
      />
      <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
        <Segmented label="Which tasks" options={options} value={view} onChange={(v) => update({ view: v === 'open' ? undefined : v, page: undefined })} />
        {view !== 'epics' && (
          <SearchInput value={box.query} onChange={box.setQuery} placeholder="Search titles or #number" className="w-full sm:w-64" />
        )}
      </div>
      {search.createdIn && view !== 'epics' && (
        <div className="px-5 pb-3">
          <FilterChip
            label={`Created in the ${RANGE_LABELS[search.createdIn].toLowerCase()}`}
            onRemove={() => update({ createdIn: undefined, page: undefined })}
          />
        </div>
      )}
      {view === 'epics' ? (
        <EpicsList groupId={groupId} page={page} onPage={(p) => update({ page: p > 1 ? p : undefined })} />
      ) : (
        <TaskList
          groupId={groupId}
          filter={filter}
          createdIn={search.createdIn}
          q={search.q}
          page={page}
          onPage={(p) => update({ page: p > 1 ? p : undefined })}
          onClearSearch={box.clear}
        />
      )}
    </Card>
  );
}
