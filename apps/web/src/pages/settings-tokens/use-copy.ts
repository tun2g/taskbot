import { useCallback } from 'react';

import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/clipboard';

/** Copy to the clipboard with a toast (+ haptic, via the toast) either way. */
export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (text: string) => {
      if (await copyText(text)) toast.success('Copied', { key: 'copy' });
      else toast.error("Couldn't copy. Select the text and copy it manually.", { key: 'copy' });
    },
    [toast],
  );
}
