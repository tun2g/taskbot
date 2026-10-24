import type { AdminAuditEntry } from '@tbot/shared';
import { AI_DEFAULT_ALERT_AT_PERCENT } from '@tbot/shared';

import type { AiSettingsInput } from '@/api/settings';

const SETTINGS_ACTIONS = new Set(['settings.ai.update', 'settings.ai.restore']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The AI settings as they were before this audit entry's change — null when the entry can't be restored. */
export function settingsBefore(entry: AdminAuditEntry): AiSettingsInput | null {
  if (!SETTINGS_ACTIONS.has(entry.action)) return null;
  const before = entry.details?.before;
  if (!isObj(before)) return null;
  return {
    dailyCallLimit: numOrNull(before.dailyCallLimit),
    dailyBudgetUsd: numOrNull(before.dailyBudgetUsd),
    alertAtPercent: numOrNull(before.alertAtPercent) ?? AI_DEFAULT_ALERT_AT_PERCENT,
    userDailyLimit: numOrNull(before.userDailyLimit),
    pricing: (isObj(before.pricing) ? before.pricing : {}) as AiSettingsInput['pricing'],
  };
}
