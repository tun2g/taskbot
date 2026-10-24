import { useEffect, useState } from 'react';

import { useDebouncedValue } from './use-debounced-value';

/**
 * A search box whose text is local while typing and lands in the URL after a short pause (`onCommit`).
 * Back/forward or a link that changes the URL value updates the box.
 */
export function useUrlSearchBox(urlValue: string | undefined, onCommit: (q: string | undefined) => void) {
  const [query, setQuery] = useState(urlValue ?? '');
  const debounced = useDebouncedValue(query.trim(), 300);
  useEffect(() => {
    if ((urlValue ?? '') !== debounced) onCommit(debounced || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    setQuery(urlValue ?? '');
  }, [urlValue]);
  return { query, setQuery, clear: () => setQuery('') };
}
