import { Link } from '@tanstack/react-router';

import { buttonClass, Spinner } from '@/components/ui/button';

export function LoginCallbackContent({ error }: { error: string | null }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-[var(--shadow)]">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-text">Couldn’t log you in</h1>
            <p className="mt-2 text-sm leading-relaxed text-text-2">{error}</p>
            <Link to="/login" search={{}} className={buttonClass('primary', 'md', 'mt-5 w-full')}>
              Get a new login link
            </Link>
          </>
        ) : (
          <>
            <Spinner className="size-6 text-accent" />
            <p className="mt-3 text-sm text-text-2">Logging you in…</p>
          </>
        )}
      </div>
    </div>
  );
}
