import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { Button } from './button';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton', className)} />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 px-5 py-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-8 w-64" />
      <Skeleton className="mb-6 h-4 w-96 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="mt-4 h-72 w-full" />
    </div>
  );
}

/** Empty state written for the owner's situation ("No groups are waiting for approval."). */
export function EmptyState({ title, body, action, compact }: { title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'px-5 py-8' : 'px-6 py-16')}>
      <p className="text-base font-bold text-text">{title}</p>
      {body && <p className="mt-1.5 max-w-md text-[15px] leading-relaxed text-text-3">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retrying,
  title = 'Couldn’t load this page',
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
      <p className="text-base font-semibold text-text">{title}</p>
      <p className="mt-1.5 max-w-md text-[15px] leading-relaxed text-text-3">{message}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** A plain-language callout (tracking started late, unpriced calls, …). */
export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'warn'; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-xl border border-l-4 px-4 py-3 text-[15px] leading-relaxed',
        tone === 'warn' ? 'border-warn/25 border-l-warn bg-warn-soft text-text' : 'border-brand/25 border-l-brand bg-brand-soft text-text',
      )}
    >
      <div className="flex min-w-0 gap-2">
        <span aria-hidden className={tone === 'warn' ? 'text-warn' : 'text-accent-text'}>
          {tone === 'warn' ? '⚠' : 'ⓘ'}
        </span>
        <div className="min-w-0">{children}</div>
      </div>
      {action}
    </div>
  );
}
