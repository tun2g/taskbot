import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { NavIcon } from './icons';
import { currentSection, RANGED } from './nav-items';
import { RangeSelect } from './range-select';
import { Sidebar } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ranged = RANGED.some((re) => re.test(pathname));
  const section = currentSection(pathname);

  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-sidebar lg:block">
        <Sidebar />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-sidebar">
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-8">
        <button
          type="button"
          className="-ml-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 lg:hidden"
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
        >
          <NavIcon name="menu" className="size-5" />
        </button>
        {/* Phones and tablets have no sidebar: say where you are next to the menu button. */}
        <span className="min-w-0 flex-1 truncate text-base font-bold text-text lg:hidden">{section}</span>
        <div className="hidden flex-1 lg:block" />
        {ranged && <RangeSelect />}
        <ThemeToggle />
        <UserMenu />
      </header>
      <main className="mx-auto w-full min-w-0 max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
