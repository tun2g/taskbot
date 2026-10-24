import { useState } from 'react';

import { useSession } from '@/api/auth';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Menu } from '@/components/ui/menu';

import { ActiveSessionsDialog } from './active-sessions-dialog';
import { useLogout } from './use-logout';

export function UserMenu() {
  const session = useSession();
  const [confirmAll, setConfirmAll] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const { busy, logOut } = useLogout();
  const doLogout = (everywhere: boolean) => logOut(everywhere).finally(() => setConfirmAll(false));
  const owner = session.data?.owner;

  const initials = (owner?.name ?? 'A')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <Menu
        label="Account"
        triggerClassName="h-10 gap-2.5 rounded-full py-1 pr-3 pl-1"
        trigger={
          <>
            <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm text-on-accent font-semibold text-accent-text">
              {initials}
            </span>
            <span className="hidden max-w-40 truncate text-[15px] font-medium text-text sm:block">
              {owner?.name ?? 'Owner'}
            </span>
          </>
        }
        header={
          owner && (
            <div className="mb-1 border-b border-border px-3 pt-2 pb-2.5">
              <p className="text-[15px] font-semibold text-text">{owner.name}</p>
              <p className="text-[13px] text-text-3">{owner.username ? `@${owner.username} · ` : ''}Bot owner</p>
            </div>
          )
        }
        items={[
          {
            label: 'Active sessions',
            hint: 'Browsers signed in to the admin app',
            onSelect: () => setSessionsOpen(true),
          },
          { label: 'Log out', hint: 'Sign out of this browser', onSelect: () => void doLogout(false) },
          {
            label: 'Log out everywhere',
            hint: 'Sign out every browser, including this one',
            danger: true,
            onSelect: () => setConfirmAll(true),
          },
        ]}
      />
      <ConfirmDialog
        open={confirmAll}
        pending={busy}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => void doLogout(true)}
        options={{
          title: 'Log out everywhere?',
          body: (
            <p>
              Every browser signed in to the admin app is signed out, including this one. Use this if you logged in on a
              device you no longer trust. You can log in again with a new link from Telegram.
            </p>
          ),
          confirmLabel: 'Log out everywhere',
          variant: 'danger',
        }}
      />
      <ActiveSessionsDialog open={sessionsOpen} onClose={() => setSessionsOpen(false)} />
    </>
  );
}
