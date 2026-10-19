import type { ITaskActivity, IUser } from '@tbot/shared';

import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatRelative } from '@/lib/dates';
import { displayName } from '@/lib/user';

const VERBS: Record<string, string> = {
  created: 'created this task',
  status: 'changed status',
  assignee: 'changed assignee',
  priority: 'changed priority',
  type: 'changed type',
  title: 'renamed the task',
  description: 'edited the description',
  due_date: 'changed the due date',
  deleted: 'deleted the task',
};

const VIA: Record<ITaskActivity['via'], { label: string; className: string }> = {
  app: { label: '📱 app', className: 'tint-neutral' },
  bot: { label: '🤖 bot', className: 'tint-neutral' },
  ai: { label: '✨ AI', className: 'tint-neutral' },
};

interface ActivityTimelineProps {
  items: ITaskActivity[];
  members: IUser[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function ActivityTimeline({ items, members, isLoading, error, onRetry }: ActivityTimelineProps) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-tg-hint">Activity</h3>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error ? (
        <p className="text-sm text-tg-hint">
          Couldn't load activity: {error}{' '}
          <button type="button" onClick={onRetry} className="min-h-11 font-medium text-tg-link">
            Retry
          </button>
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-tg-hint">No activity recorded yet.</p>
      ) : (
        <ol className="relative ml-1.5 border-l border-tg-separator">
          {items.map((item) => {
            const actor = item.actor
              ? displayName(item.actor, { members, fallback: 'Someone' })
              : item.via === 'ai'
                ? 'AI'
                : 'Someone';
            const verb = VERBS[item.action] ?? 'updated the task';
            const showChange = item.action !== 'description' && item.action !== 'created' && (item.from || item.to);
            const via = VIA[item.via];
            return (
              <li key={item._id} className="mb-3 ml-4 last:mb-0">
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-tg-hint/60" aria-hidden />
                <p className="text-sm text-tg-text">
                  <span className="font-medium">{actor}</span> {verb}
                  {showChange && (
                    <>
                      {' '}
                      <span className="text-tg-hint">{item.from || 'none'}</span> → <span>{item.to || 'none'}</span>
                    </>
                  )}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-tg-hint">
                  <time dateTime={item.createdAt} title={formatDate(item.createdAt)}>
                    {formatRelative(item.createdAt)}
                  </time>
                  {via && <span className={`rounded-full px-1.5 py-px text-[11px] font-medium ${via.className}`}>via {via.label}</span>}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
