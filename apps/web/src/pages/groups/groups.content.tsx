import type { IGroupSummary } from '@tbot/shared';

import { Layout } from '@/components/layout/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { StateMessage } from '@/components/ui/state';
import { Button } from '@/components/ui/button';

import type { BoardSearch } from '../tasks/board-search';
import { GroupCard } from './components/group-card';

interface GroupsContentProps {
  groups: IGroupSummary[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  isRetrying: boolean;
  onOpenGroup: (groupId: string, search?: BoardSearch) => void;
  onSignOut?: () => void;
}

export function GroupsContent({
  groups,
  isLoading,
  error,
  onRetry,
  isRetrying,
  onOpenGroup,
  onSignOut,
}: GroupsContentProps) {
  return (
    <Layout
      title="Your groups"
      actions={
        onSignOut && (
          <Button variant="link" onClick={onSignOut}>
            Sign out
          </Button>
        )
      }
    >
      {isLoading ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <StateMessage
          icon="⚠️"
          title="Couldn't load your groups"
          body={error}
          action={
            <Button variant="primary" onClick={onRetry} disabled={isRetrying}>
              {isRetrying ? 'Retrying…' : 'Retry'}
            </Button>
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
                Send <code>/new fix the login page</code> in the group — or mention the bot in a message.
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
