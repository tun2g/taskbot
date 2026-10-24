import type { AdminAiSettings } from '@tbot/shared';

import type { AiSettingsInput } from '@/api/settings';
import { Card, PageHeader } from '@/components/ui/card';
import { ErrorState, PageSkeleton } from '@/components/ui/states';

import { SettingsForm } from './components/settings-form';

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
      />
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={onRetry} retrying={retrying} />
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
