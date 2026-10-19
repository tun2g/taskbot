export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-tg-secondary ${className}`} aria-hidden />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-md bg-tg-section p-3" aria-hidden>
      <div className="flex gap-2">
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="mt-2.5 h-4 w-4/5" />
      <Skeleton className="mt-2.5 h-3 w-1/3" />
    </div>
  );
}
