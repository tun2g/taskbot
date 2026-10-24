import type { AdminAuditEntry } from '@tbot/shared';
import { useState } from 'react';

import { useAiSettings, useSaveAiSettings } from '@/api/settings';

import { settingsBefore } from './restore';

/** "Restore the values from before this change" on a settings audit entry: pick → review the diff → save. */
export function useRestoreSettings() {
  const [entry, setEntry] = useState<AdminAuditEntry | null>(null);
  const current = useAiSettings(!!entry);
  const save = useSaveAiSettings();
  const before = entry ? settingsBefore(entry) : null;

  return {
    entry,
    before,
    current: current.data,
    pending: save.isPending,
    open: setEntry,
    cancel: () => setEntry(null),
    confirm: () => {
      if (entry && before) save.mutate({ ...before, restoredFrom: entry.id }, { onSuccess: () => setEntry(null) });
    },
  };
}
