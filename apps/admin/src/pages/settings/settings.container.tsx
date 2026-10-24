import { useAiSettings, useSaveAiSettings } from '@/api/settings';
import { getErrorMessage } from '@/lib/api-client';

import { SettingsContent } from './settings.content';

export function SettingsContainer() {
  const settings = useAiSettings();
  const save = useSaveAiSettings();

  return (
    <SettingsContent
      settings={settings.data}
      loading={settings.isLoading}
      error={settings.isError ? getErrorMessage(settings.error) : null}
      onRetry={() => void settings.refetch()}
      retrying={settings.isFetching}
      saving={save.isPending}
      onSave={(input) => save.mutate(input)}
    />
  );
}
