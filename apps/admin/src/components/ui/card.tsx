import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-xl border border-border bg-surface shadow-[var(--shadow)]', className)}>{children}</section>;
}

/** Card title with an always-visible subtitle that explains what the numbers mean. */
export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 pb-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-text">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-text-3">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-4 pb-4', className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-text-2">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** A label/value pair for detail headers ("Added by", "Timezone"). */
export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-3">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-text">{children}</dd>
    </div>
  );
}
