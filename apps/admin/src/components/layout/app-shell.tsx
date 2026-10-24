import type { AdminRange } from '@tbot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { logout, useSession } from '@/api/auth';
import { usePendingCount } from '@/api/groups';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Menu } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/nav';
import { getErrorMessage, isMockMode } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { RANGE_LABELS } from '@/lib/labels';
import { DEFAULT_RANGE, RANGES } from '@/lib/search';
import { toast } from '@/lib/toast';

import { NavIcon } from './icons';

const NAV = [
  { to: '/', label: 'Overview', icon: 'overview', exact: true },
  { to: '/groups', label: 'Groups', icon: 'groups' },
  { to: '/users', label: 'People', icon: 'users' },
  { to: '/ai', label: 'AI & cost', icon: 'ai' },
  { to: '/mcp', label: 'MCP', icon: 'mcp' },
  { to: '/system', label: 'System', icon: 'system' },
  { to: '/audit-log', label: 'Audit log', icon: 'audit' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
] as const;

/** Pages whose numbers depend on the date range (the selector only shows there). */
const RANGED = [/^\/$/, /^\/groups\/[^/]+$/, /^\/users\/[^/]+$/, /^\/ai$/, /^\/mcp$/];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pending = usePendingCount();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-3 px-5 pt-6 pb-5">
        <img src="/favicon.svg" alt="" className="size-9" />
        <span className="leading-tight">
          <span className="block text-base font-semibold text-text">TaskBot</span>
          <span className="block text-[13px] text-text-3">Owner admin</span>
        </span>
      </Link>
      <ul className="flex-1 space-y-1 px-3">
        {NAV.map((item) => {
          const active = 'exact' in item ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors',
                  active ? 'bg-accent-soft font-semibold text-accent-text' : 'font-medium text-text-2 hover:bg-surface-2 hover:text-text',
                )}
              >
                <NavIcon name={item.icon} />
                <span className="flex-1">{item.label}</span>
                {item.to === '/groups' && pending > 0 && (
                  <span
                    title={`${pending} group${pending === 1 ? '' : 's'} waiting for your approval`}
                    className="rounded-full bg-warn px-2 py-0.5 text-[13px] leading-none font-semibold text-white tabular"
                  >
                    {pending}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {isMockMode && (
        <p className="mx-3 mb-4 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn">
          Mock mode — fixture data, nothing is saved.
        </p>
      )}
    </nav>
  );
}

function RangeSelect() {
  const search = useSearch({ strict: false }) as { range?: AdminRange };
  const navigate = useNavigate();
  return (
    <Segmented
      label="Date range"
      value={search.range ?? DEFAULT_RANGE}
      options={RANGES.map((r) => ({ value: r, label: r === '7d' ? '7 days' : r === '30d' ? '30 days' : '90 days', title: RANGE_LABELS[r] }))}
      onChange={(range) =>
        navigate({
          to: '.',
          search: (prev: Record<string, unknown>) => ({ ...prev, range: range === DEFAULT_RANGE ? undefined : range, page: undefined }),
          replace: true,
        } as never)
      }
    />
  );
}

function UserMenu() {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const owner = session.data?.owner;

  const doLogout = async (everywhere: boolean) => {
    setBusy(true);
    try {
      await logout(everywhere);
      queryClient.clear();
      await navigate({ to: '/login', search: {} });
      if (everywhere) toast.success('Logged out everywhere', 'Every browser signed in to the admin app has been signed out.');
    } catch (e) {
      toast.error('Couldn’t log out', getErrorMessage(e));
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  };

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
            <span className="hidden max-w-40 truncate text-[15px] font-medium text-text sm:block">{owner?.name ?? 'Owner'}</span>
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
    </>
  );
}

export function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ranged = RANGED.some((re) => re.test(pathname));

  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface">
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur sm:px-8">
        <button
          type="button"
          className="-ml-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 lg:hidden"
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
        >
          <NavIcon name="menu" className="size-5" />
        </button>
        <div className="flex-1" />
        {ranged && <RangeSelect />}
        <UserMenu />
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
