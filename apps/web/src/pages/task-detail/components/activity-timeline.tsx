import type { ITaskActivity, IUser } from '@tbot/shared';

import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/card';
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

/** `from` / `to` of an "epic" activity are plain epic titles. */
function describeEpicChange(from?: string | null, to?: string | null): string {
  if (to && from) return `moved it from epic “${from}” to “${to}”`;
  if (to) return `added it to epic “${to}”`;
  if (from) return `removed it from epic “${from}”`;
  return 'changed the epic';
}

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
      <SectionHeading>Activity</SectionHeading>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error ? (
        <p className="text-sm text-tg-hint">
          Couldn't load activity: {error}{' '}
          <Button variant="link" size="sm" onClick={onRetry}>
            Retry
          </Button>
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
            const epicVerb = item.action === 'epic' ? describeEpicChange(item.from, item.to) : null;
            const verb = epicVerb ?? VERBS[item.action] ?? 'updated the task';
            const showChange =
              !epicVerb && item.action !== 'description' && item.action !== 'created' && (item.from || item.to);
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
                  {via && (
                    <span className={`rounded-full px-1.5 py-px text-[11px] font-medium ${via.className}`}>
                      via {via.label}
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
