import { Link, useRouterState } from '@tanstack/react-router';

import { usePendingCount } from '@/api/groups';
import { Tooltip } from '@/components/ui/tooltip';
import { isMockMode } from '@/lib/api-client';
import { cn } from '@/lib/cn';

import { NavIcon } from './icons';
import { NAV } from './nav-items';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
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
          const active =
            'exact' in item ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors',
                  active
                    ? 'bg-accent-soft font-semibold text-accent-text'
                    : 'font-medium text-text-2 hover:bg-surface-2 hover:text-text',
                )}
              >
                <NavIcon name={item.icon} />
                <span className="flex-1">{item.label}</span>
                {item.to === '/groups' && pending > 0 && (
                  <Tooltip content={`${pending} group${pending === 1 ? '' : 's'} waiting for your approval`}>
                    <span className="rounded-full bg-warn px-2 py-0.5 text-[13px] leading-none font-semibold text-white tabular">
                      {pending}
                    </span>
                  </Tooltip>
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
