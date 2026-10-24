import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { sessionQuery, useLoginLinkStatus } from '@/api/auth';

/**
 * Watches whether the login link was used. If it was opened in this browser (another tab), this tab now has the
 * session cookie too and moves on; otherwise it says the link was used in another browser. The status endpoint
 * never signs anyone in, so a link opened elsewhere can't log this browser in.
 */
export function useLinkUsedElsewhere(requestId: string | undefined, watching: boolean): boolean {
  const status = useLoginLinkStatus(requestId, watching);
  const queryClient = useQueryClient();
  const router = useRouter();
  const [elsewhere, setElsewhere] = useState(false);

  // A new link starts unused.
  useEffect(() => setElsewhere(false), [requestId]);

  useEffect(() => {
    if (status.data !== 'used') return;
    let cancelled = false;
    queryClient
      .fetchQuery({ ...sessionQuery, staleTime: 0 })
      .then(() => {
        // The callback tab already went to the saved page; this one goes home.
        if (!cancelled) router.history.replace('/');
      })
      .catch(() => {
        if (!cancelled) setElsewhere(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status.data, queryClient, router]);

  return elsewhere;
}
