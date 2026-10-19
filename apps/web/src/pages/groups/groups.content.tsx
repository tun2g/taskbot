import type { IGroupSummary } from '@tbot/shared';

import { Layout } from '@/components/layout/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonLink, buttonPrimary, StateMessage } from '@/components/ui/state';

import { GroupCard } from './components/group-card';

interface GroupsContentProps {
  groups: IGroupSummary[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  isRetrying: boolean;
  onOpenGroup: (groupId: string) => void;
  onSignOut?: () => void;
}

export function GroupsContent({ groups, isLoading, error, onRetry, isRetrying, onOpenGroup, onSignOut }: GroupsContentProps) {
  return (
    <Layout
      title="Your groups"
      actions={
        onSignOut && (
          <button type="button" onClick={onSignOut} className={buttonLink}>
            Sign out
          </button>
        )
      }
    >
      {isLoading ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <StateMessage
          icon="⚠️"
          title="Couldn't load your groups"
          body={error}
          action={
            <button type="button" onClick={onRetry} disabled={isRetrying} className={buttonPrimary}>
              {isRetrying ? 'Retrying…' : 'Retry'}
            </button>
          }
        />
      ) : groups.length === 0 ? (
        <StateMessage
          icon="👋"
          title="No groups yet"
          body={
            <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-left">
              <li>Add the bot to a Telegram group.</li>
              <li>
                Send <code>/task fix the login page</code> in the group — or mention the bot in a message.
              </li>
              <li>Come back here: the group's board appears once you're a member.</li>
            </ol>
          }
        />
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {groups.map((group) => (
            <GroupCard key={group._id} group={group} onOpen={onOpenGroup} />
          ))}
        </div>
      )}
    </Layout>
  );
}
