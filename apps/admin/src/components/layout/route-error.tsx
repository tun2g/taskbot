import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { Button, buttonClass } from '@/components/ui/button';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';

/** Error boundary for every route: says what happened and offers a retry. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const queryReset = useQueryErrorResetBoundary();
  useEffect(() => queryReset.reset(), [queryReset]);
  const status = getErrorStatus(error);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <p className="text-base font-semibold text-text">
        {status === 404 ? 'This page doesn’t exist anymore' : 'Something went wrong on this page'}
      </p>
      <p className="mt-2 text-sm text-text-3">
        {status === 404
          ? 'It may have been deleted. Go back to the overview to continue.'
          : getErrorMessage(error, 'An unexpected error happened while showing this page.')}
      </p>
      <div className="mt-5 flex gap-2">
        <Button
          variant="primary"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          Try again
        </Button>
        <Link to="/" className={buttonClass('secondary')}>
          Go to overview
        </Link>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <p className="text-base font-semibold text-text">Page not found</p>
      <p className="mt-2 text-sm text-text-3">The link may be old or mistyped.</p>
      <Link to="/" className={buttonClass('primary', 'md', 'mt-5')}>
        Go to overview
      </Link>
    </div>
  );
}
