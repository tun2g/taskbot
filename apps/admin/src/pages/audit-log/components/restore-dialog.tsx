import type { AdminAiSettings, AdminAuditEntry } from '@tbot/shared';
import { aiSettingsChangeLines } from '@tbot/shared';

import type { AiSettingsInput } from '@/api/settings';
import { ConfirmDialog } from '@/components/ui/dialog';
import { formatDateTimeUtc } from '@/lib/format';

/** Lists exactly what restoring would change (current → earlier value) before anything is written. */
export function RestoreDialog({
  entry,
  before,
  current,
  pending,
  onCancel,
  onConfirm,
}: {
  entry: AdminAuditEntry | null;
  before: AiSettingsInput | null;
  /** The settings as saved now (undefined while loading). */
  current: AdminAiSettings | undefined;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const lines = current && before ? aiSettingsChangeLines(current, before, current.defaults.builtInPricing) : null;
  return (
    <ConfirmDialog
      open={!!entry}
      pending={pending}
      onCancel={onCancel}
      onConfirm={onConfirm}
      options={
        entry && {
          title: 'Restore the earlier AI settings?',
          loadingBody: !lines || lines.length === 0,
          body: !lines ? (
            <p>Loading the current settings…</p>
          ) : lines.length === 0 ? (
            <p>
              Nothing to restore: the settings already have the values from before the change on{' '}
              {formatDateTimeUtc(entry.at)}.
            </p>
          ) : (
            <>
              <p>Puts the AI settings back to how they were before the change on {formatDateTimeUtc(entry.at)}:</p>
              <ul className="list-disc space-y-1 pl-5 text-[15px] text-text">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="text-[13px] text-text-3">
                The bot applies them within 30 seconds. The restore is recorded here too.
              </p>
            </>
          ),
          confirmLabel: 'Restore',
        }
      }
    />
  );
}
