import { useBlocker } from '@tanstack/react-router';
import { useEffect } from 'react';

import { ConfirmDialog } from '@/components/ui/dialog';

/**
 * Asks before leaving the page (in-app navigation or closing the tab) while the form has unsaved changes.
 * Render the returned element anywhere in the form.
 */
export function UnsavedChangesGuard({ when, what = 'your changes' }: { when: boolean; what?: string }) {
  const blocker = useBlocker({ shouldBlockFn: () => when, enableBeforeUnload: () => when, withResolver: true });

  useEffect(() => {
    if (!when && blocker.status === 'blocked') blocker.proceed?.();
  }, [when, blocker]);

  return (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      onCancel={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
      options={{
        title: 'Leave without saving?',
        body: <p>You haven’t saved {what}. If you leave now they’re lost.</p>,
        confirmLabel: 'Leave and discard',
        cancelLabel: 'Keep editing',
        variant: 'danger',
      }}
    />
  );
}
