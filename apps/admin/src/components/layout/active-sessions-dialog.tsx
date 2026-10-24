import type { AdminSessionRow } from '@tbot/shared';

import { useActiveSessions, useRevokeSession } from '@/api/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { RelativeTime } from '@/components/ui/values';
import { getErrorMessage } from '@/lib/api-client';

function SessionItem({
  session: s,
  revoking,
  onRevoke,
}: {
  session: AdminSessionRow;
  revoking: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0">
        <p className="font-medium text-text">
          {s.browser}
          {s.ip && <span className="font-normal text-text-2"> · {s.ip}</span>}
        </p>
        <p className="text-[13px] text-text-3">
          Signed in <RelativeTime value={s.createdAt} />
          {s.lastSeenAt && (
            <>
              {' '}
              · last active <RelativeTime value={s.lastSeenAt} />
            </>
          )}
        </p>
      </div>
      {s.current ? (
        <Badge tone="accent">This browser</Badge>
      ) : (
        <Button size="sm" variant="danger-outline" loading={revoking} onClick={onRevoke}>
          Sign out
        </Button>
      )}
    </li>
  );
}

/** Every browser signed in to the admin app, so the owner can spot and sign out one they don't recognise. */
export function ActiveSessionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sessions = useActiveSessions(open);
  const revoke = useRevokeSession();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Active sessions"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="text-[15px]">
        Browsers signed in to the admin app. The address is approximate (it’s where the sign-in came from). Don’t
        recognise one? Sign it out — and if you think someone else got in, use “Log out everywhere” in the account menu.
      </p>
      {sessions.isLoading ? (
        <TableSkeleton rows={2} />
      ) : sessions.isError ? (
        <ErrorState
          title="Couldn’t load your sessions"
          message={getErrorMessage(sessions.error)}
          onRetry={() => void sessions.refetch()}
          retrying={sessions.isFetching}
        />
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {(sessions.data ?? []).map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              revoking={revoke.isPending && revoke.variables?.id === s.id}
              onRevoke={() => revoke.mutate(s)}
            />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
