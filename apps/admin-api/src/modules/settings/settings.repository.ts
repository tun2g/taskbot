import { AiSettings, Setting, SETTING_KEYS } from '@tbot/db';

/** The stored AI settings document (partial: unset fields fall back to defaults in the service). */
export async function findAiSettingsDoc(): Promise<{ value?: Partial<AiSettings>; updatedAt?: Date } | null> {
  return Setting.findOne({ key: SETTING_KEYS.AI }).lean<{ value?: Partial<AiSettings>; updatedAt?: Date }>();
}

export async function saveAiSettings(value: AiSettings): Promise<void> {
  await Setting.updateOne({ key: SETTING_KEYS.AI }, { $set: { value } }, { upsert: true });
}
