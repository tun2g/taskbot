import type { AdminAiSettings } from '@tbot/shared';

import type { AiSettingsInput } from '@/api/settings';
import { TextLink } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { ErrorState, PageSkeleton } from '@/components/ui/states';
import { RelativeTime } from '@/components/ui/values';

import { SettingsForm } from './components/settings-form';

/** "Last changed 6 days ago · See history" — the way back to what was there before. */
function LastChanged({ at }: { at: string | null | undefined }) {
  return (
    <p className="mt-2 text-[15px] text-text-3">
      {at ? (
        <>
          Last changed <RelativeTime value={at} />
        </>
      ) : (
        'Never changed — the bot uses its defaults'
      )}{' '}
      ·{' '}
      <TextLink to="/audit-log" search={{ targetType: 'settings' }}>
        See history
      </TextLink>
    </p>
  );
}

export function SettingsContent({
  settings,
  loading,
  error,
  onRetry,
  retrying,
  saving,
  onSave,
}: {
  settings: AdminAiSettings | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  saving: boolean;
  onSave: (input: AiSettingsInput) => void;
}) {
  return (
    <div>
      <PageHeader
        title="AI settings"
        subtitle="Limits and prices for AI features across every group. Per-group and per-person limits are set on their own pages."
      >
        {settings && <LastChanged at={settings.lastChangedAt} />}
      </PageHeader>
      {error ? (
        <Card>
          <ErrorState title="Couldn’t load the AI settings" message={error} onRetry={onRetry} retrying={retrying} />
        </Card>
      ) : loading || !settings ? (
        <PageSkeleton />
      ) : (
        // Re-mount the form when the saved settings change (after a save or an edit elsewhere).
        <SettingsForm key={JSON.stringify(settings)} settings={settings} saving={saving} onSave={onSave} />
      )}
    </div>
  );
}
