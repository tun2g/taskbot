import { Link, useRouterState } from '@tanstack/react-router';

import { usePendingCount } from '@/api/groups';
import { Tooltip } from '@/components/ui/tooltip';
import { isMockMode } from '@/lib/api-client';
import { cn } from '@/lib/cn';

import { NavIcon } from './icons';
import { NAV, NAV_SECTIONS } from './nav-items';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pending = usePendingCount();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className="flex h-16 items-center gap-2.5 px-5">
        <img src="/favicon.svg" alt="" className="size-8" />
        <span className="text-[17px] font-black tracking-tight text-text">TaskBot</span>
        <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-accent-text uppercase">
          Admin
        </span>
      </Link>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pt-2 pb-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section}>
            <p className="mb-1.5 px-3 text-[12px] font-bold tracking-[0.08em] text-text-3 uppercase">{section}</p>
            <ul className="space-y-0.5">
              {NAV.filter((item) => item.section === section).map((item) => {
                const active =
                  'exact' in item ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl px-3 py-2 text-[15px] transition-colors',
                        active
                          ? 'bg-brand-soft font-bold text-accent-text'
                          : 'text-text hover:bg-surface-3/60',
                      )}
                    >
                      <NavIcon name={item.icon} className={cn('size-[18px]', active ? 'text-brand' : 'text-text-3')} />
                      <span className="flex-1">{item.label}</span>
                      {item.to === '/groups' && pending > 0 && (
                        <Tooltip content={`${pending} group${pending === 1 ? '' : 's'} waiting for your approval`}>
                          <span className="min-w-5 rounded-full bg-warn-soft px-1.5 py-0.5 text-center text-[12px] leading-none font-bold text-warn tabular ring-1 ring-warn/25">
                            {pending}
                          </span>
                        </Tooltip>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {isMockMode && (
        <p className="mx-3 mb-4 rounded-xl border border-warn/25 bg-warn-soft px-3 py-2.5 text-[13px] text-warn">
          Mock mode — fixture data, nothing is saved.
        </p>
      )}
    </nav>
  );
}
